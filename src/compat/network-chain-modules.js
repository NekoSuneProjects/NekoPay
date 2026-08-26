'use strict';

const network = require('../network');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEFAULT_EVM_SCAN_BLOCKS = Number(process.env.NEKOPAY_EVM_SCAN_MAX_BLOCKS || 5000);

function normalizeTimestamp(value) {
  const number = Number(value || 0);
  return number > 1e12 ? Math.floor(number / 1000) : number;
}

function normalizeLegacyArgs(timestamp, memo, minimumConfirmations) {
  if (typeof timestamp === 'string' && timestamp && !/^\d+(?:\.\d+)?$/.test(timestamp) && Number.isFinite(Number(memo))) {
    return { timestamp: Number(memo), memo: timestamp, minimumConfirmations: Number(minimumConfirmations || 0) };
  }
  if (typeof memo === 'number' && !minimumConfirmations) {
    return { timestamp, memo: null, minimumConfirmations: Number(memo) };
  }
  return { timestamp, memo, minimumConfirmations: Number(minimumConfirmations || 0) };
}

function decimalToUnits(value, decimals) {
  const text = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid payment amount');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(`${whole}${(fraction + '0'.repeat(decimals)).slice(0, decimals)}`);
}

function topicAddress(address) {
  const clean = String(address || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error('Invalid EVM receiving address');
  return `0x${clean.padStart(64, '0')}`;
}

function hexNumber(value) {
  return Number(BigInt(String(value || '0x0')));
}

async function findStartBlock(client, since, latest) {
  if (!since) return Math.max(0, latest - DEFAULT_EVM_SCAN_BLOCKS);
  let low = Math.max(0, latest - DEFAULT_EVM_SCAN_BLOCKS);
  let high = latest;
  let answer = low;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = await client.block(mid, false);
    const time = hexNumber(block?.timestamp || '0x0');
    if (time < since) {
      answer = mid + 1;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.min(answer, latest);
}

async function verifyIndexedNative(symbol, client, recipient, expectedUnits, since, minimumConfirmations) {
  let explorer;
  try { explorer = network.getExplorer(symbol); } catch (_) { return null; }
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const result = await explorer.transactions(recipient, { cursor, limit: 50 });
    for (const transaction of result.transactions || []) {
      if (since && transaction.timestamp && transaction.timestamp < since) continue;
      if (String(transaction.to || '').toLowerCase() !== String(recipient).toLowerCase()) continue;
      if (BigInt(String(transaction.value || 0)) !== expectedUnits) continue;
      const latest = await client.blockNumber();
      const conf = transaction.blockHeight ? Math.max(0, latest - Number(transaction.blockHeight) + 1) : 0;
      return {
        exists: conf >= Number(minimumConfirmations || 0),
        txid: transaction.txid || '',
        conf,
        raw: transaction
      };
    }
    if (!result.next) break;
    cursor = result.next;
  }
  return null;
}

async function verifyRpcNative(client, recipient, expectedUnits, since, minimumConfirmations) {
  const latest = await client.blockNumber();
  const start = await findStartBlock(client, since, latest);
  for (let height = latest; height >= start; height -= 1) {
    const block = await client.block(height, true);
    const timestamp = hexNumber(block?.timestamp || '0x0');
    if (since && timestamp && timestamp < since) break;
    for (const transaction of block?.transactions || []) {
      if (String(transaction?.to || '').toLowerCase() !== String(recipient).toLowerCase()) continue;
      if (BigInt(String(transaction?.value || '0x0')) !== expectedUnits) continue;
      const conf = latest - height + 1;
      return {
        exists: conf >= Number(minimumConfirmations || 0),
        txid: transaction.hash || '',
        conf,
        raw: transaction
      };
    }
  }
  return { exists: false, txid: '', conf: 0 };
}

async function verifyRpcToken(client, recipient, tokenContract, expectedUnits, since, minimumConfirmations) {
  const latest = await client.blockNumber();
  const start = await findStartBlock(client, since, latest);
  const logs = await client.logs({
    address: tokenContract,
    fromBlock: `0x${start.toString(16)}`,
    toBlock: 'latest',
    topics: [TRANSFER_TOPIC, null, topicAddress(recipient)]
  });
  const matches = (logs || [])
    .filter((log) => BigInt(String(log.data || '0x0')) === expectedUnits)
    .sort((a, b) => hexNumber(b.blockNumber) - hexNumber(a.blockNumber));
  if (!matches.length) return { exists: false, txid: '', conf: 0 };
  const match = matches[0];
  const height = hexNumber(match.blockNumber);
  const conf = Math.max(0, latest - height + 1);
  return {
    exists: conf >= Number(minimumConfirmations || 0),
    txid: match.transactionHash || '',
    conf,
    raw: match
  };
}

class RpcEvmModule {
  constructor(symbol, overrides = {}) {
    this.symbol = network.canonicalSymbol(symbol);
    this.tokenContract = overrides.tokenContract || overrides.contract || null;
    this.decimals = Number(overrides.decimals ?? 18);
    this.backendUrl = overrides.url || null;
  }

  async existsTransaction(address, amount, timestamp, memo = null, minimumConfirmations = 0) {
    if (!address) throw new Error('Payment address is required');
    if (!/^\d+(?:\.\d+)?$/.test(String(amount ?? '').trim()) || Number(amount) <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }
    const args = normalizeLegacyArgs(timestamp, memo, minimumConfirmations);
    const since = normalizeTimestamp(args.timestamp);
    const units = decimalToUnits(amount, this.decimals);
    return network.read(this.symbol, async (client) => {
      if (this.tokenContract) {
        return verifyRpcToken(client, address, this.tokenContract, units, since, args.minimumConfirmations);
      }
      const indexed = await verifyIndexedNative(this.symbol, client, address, units, since, args.minimumConfirmations).catch(() => null);
      return indexed || verifyRpcNative(client, address, units, since, args.minimumConfirmations);
    }, { url: this.backendUrl });
  }
}

function transactionTimestamp(transaction) {
  return Number(
    transaction?.blockTime
    ?? transaction?.blocktime
    ?? transaction?.time
    ?? transaction?.timestamp
    ?? 0
  );
}

function outputAddresses(output) {
  if (Array.isArray(output?.addresses)) return output.addresses.map(String);
  if (Array.isArray(output?.scriptPubKey?.addresses)) return output.scriptPubKey.addresses.map(String);
  if (output?.address) return [String(output.address)];
  return [];
}

function outputAtomicValue(output, decimals) {
  const raw = output?.value ?? output?.valueSat ?? output?.satoshis ?? null;
  if (raw == null) return null;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return BigInt(text);
  if (/^\d+\.\d+$/.test(text)) return decimalToUnits(text, decimals);
  return null;
}

async function hydrateBlockbookTransaction(client, reference) {
  if (reference && typeof reference === 'object' && Array.isArray(reference.vout)) return reference;
  const txid = typeof reference === 'string' ? reference : reference?.txid || reference?.hash;
  if (!txid) return reference;
  return client.tx(txid);
}

class RpcBlockbookModule {
  constructor(symbol, overrides = {}) {
    this.symbol = network.canonicalSymbol(symbol);
    this.decimals = Number(overrides.decimals ?? 8);
    this.backendUrl = overrides.url || null;
  }

  async existsTransaction(address, amount, timestamp, memo = null, minimumConfirmations = 0) {
    if (!address) throw new Error('Payment address is required');
    if (!/^\d+(?:\.\d+)?$/.test(String(amount ?? '').trim()) || Number(amount) <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }
    const args = normalizeLegacyArgs(timestamp, memo, minimumConfirmations);
    const since = normalizeTimestamp(args.timestamp);
    const expectedUnits = decimalToUnits(amount, this.decimals);
    const expectedAddress = String(address).toLowerCase();

    return network.read(this.symbol, async (client) => {
      for (let page = 1; page <= 5; page += 1) {
        const payload = await client.address(address, { page, pageSize: 100, details: 'txs' });
        const references = Array.isArray(payload?.transactions)
          ? payload.transactions
          : Array.isArray(payload?.txs)
            ? payload.txs
            : [];
        if (!references.length) break;

        let oldest = Number.POSITIVE_INFINITY;
        for (const reference of references) {
          const transaction = await hydrateBlockbookTransaction(client, reference);
          const txTime = transactionTimestamp(transaction);
          if (txTime > 0) oldest = Math.min(oldest, txTime);
          if (since && txTime && txTime < since) continue;

          const matched = (transaction?.vout || []).some((output) => {
            const addresses = outputAddresses(output).map((value) => value.toLowerCase());
            if (!addresses.includes(expectedAddress)) return false;
            const atomic = outputAtomicValue(output, this.decimals);
            return atomic != null && atomic === expectedUnits;
          });
          if (!matched) continue;

          const conf = Number(transaction?.confirmations || 0);
          return {
            exists: conf >= Number(args.minimumConfirmations || 0),
            txid: transaction?.txid || transaction?.hash || '',
            conf,
            raw: transaction
          };
        }

        if (references.length < 100 || (since && Number.isFinite(oldest) && oldest < since)) break;
      }
      return { exists: false, txid: '', conf: 0 };
    }, { url: this.backendUrl });
  }
}

function blockbookModule(symbol, decimals = 8) {
  return class extends RpcBlockbookModule {
    constructor(overrides = {}) { super(symbol, { decimals, ...overrides }); }
  };
}

function evmModule(symbol) {
  return class extends RpcEvmModule {
    constructor(overrides = {}) { super(symbol, overrides); }
  };
}

module.exports = {
  RpcEvmModule,
  RpcBlockbookModule,
  BTCModule: blockbookModule('BTC'),
  LTCModule: blockbookModule('LTC'),
  DOGEModule: blockbookModule('DOGE'),
  DASHModule: blockbookModule('DASH'),
  DGBModule: blockbookModule('DGB'),
  PIVXModule: blockbookModule('PIVX'),
  FLSModule: blockbookModule('FLS'),
  ETHModule: evmModule('ETH'),
  ETCModule: evmModule('ETC'),
  BNBModule: evmModule('BSC'),
  BSCModule: evmModule('BSC'),
  POLModule: evmModule('POL'),
  ARBModule: evmModule('ARB'),
  ARBITRUMModule: evmModule('ARB'),
  OPModule: evmModule('OP'),
  OPTIMISMModule: evmModule('OP'),
  BASEModule: evmModule('BASE'),
  AVAXModule: evmModule('AVAX'),
  GNOModule: evmModule('GNO'),
  GNOSISModule: evmModule('GNO'),
  CROModule: evmModule('CRO'),
  CRONOSModule: evmModule('CRO'),
  LINEAModule: evmModule('LINEA'),
  SCROLLModule: evmModule('SCROLL'),
  BLASTModule: evmModule('BLAST'),
  ZKSYNCModule: evmModule('ZKSYNC'),
  OPBNBModule: evmModule('OPBNB'),
  MNTModule: evmModule('MNT'),
  MANTLEModule: evmModule('MNT'),
  CELOModule: evmModule('CELO'),
  SONICModule: evmModule('SONIC'),
  THETAModule: evmModule('THETA'),
  BTTCModule: evmModule('BTTC')
};
