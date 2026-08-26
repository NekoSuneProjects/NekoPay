'use strict';

const { ChainModule } = require('./chain-modules');
const network = require('../network');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEFAULT_EVM_SCAN_BLOCKS = Number(process.env.NEKOPAY_EVM_SCAN_MAX_BLOCKS || 5000);

function normalizeTimestamp(value) {
  const number = Number(value || 0);
  return number > 1e12 ? Math.floor(number / 1000) : number;
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
    this.decimals = Number(overrides.decimals ?? (this.tokenContract ? 18 : 18));
    this.backendUrl = overrides.url || null;
  }

  async existsTransaction(address, amount, timestamp, memo = null, minimumConfirmations = 0) {
    if (!address) throw new Error('Payment address is required');
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Payment amount must be greater than zero');
    if (typeof timestamp === 'string' && timestamp && !/^\d+(?:\.\d+)?$/.test(timestamp) && Number.isFinite(Number(memo))) {
      [timestamp, memo] = [memo, timestamp];
    }
    if (typeof memo === 'number' && !minimumConfirmations) {
      minimumConfirmations = memo;
      memo = null;
    }
    const since = normalizeTimestamp(timestamp);
    const units = decimalToUnits(amount, this.decimals);
    return network.read(this.symbol, async (client) => {
      if (this.tokenContract) {
        return verifyRpcToken(client, address, this.tokenContract, units, since, minimumConfirmations);
      }
      const indexed = await verifyIndexedNative(this.symbol, client, address, units, since, minimumConfirmations).catch(() => null);
      return indexed || verifyRpcNative(client, address, units, since, minimumConfirmations);
    }, { url: this.backendUrl });
  }
}

function blockbookModule(symbol, decimals = 8) {
  return class extends ChainModule {
    constructor(overrides = {}) {
      const config = network.getBackendConfig(symbol);
      const urls = config.backends.map((entry) => entry.url);
      super(String(symbol).toLowerCase(), {
        ...overrides,
        kind: 'blockbook',
        decimals: Number(overrides.decimals ?? decimals),
        url: overrides.url || urls[0],
        altExplorerUrls: overrides.altExplorerUrls || urls.slice(1)
      });
    }
  };
}

function evmModule(symbol) {
  return class extends RpcEvmModule {
    constructor(overrides = {}) { super(symbol, overrides); }
  };
}

module.exports = {
  RpcEvmModule,
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
