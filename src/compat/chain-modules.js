'use strict';

const axios = require('axios');

const DEFAULT_TIMEOUT = Number(process.env.NEKOPAY_CHAIN_TIMEOUT_MS || 12000);

const CHAIN_CONFIG = {
  hive: {
    kind: 'graphene',
    symbol: 'HIVE',
    urls: ['https://api.hive.blog', 'https://anyx.io', 'https://hived.privex.io', 'https://rpc.ausbit.dev']
  },
  hbd: {
    kind: 'graphene',
    symbol: 'HBD',
    urls: ['https://api.hive.blog', 'https://anyx.io', 'https://hived.privex.io', 'https://rpc.ausbit.dev']
  },
  blurt: {
    kind: 'graphene',
    symbol: 'BLURT',
    urls: ['https://rpc.beblurt.com', 'https://blurt-rpc.saboin.com', 'https://rpc.blurt.one', 'https://rpc.blurt.live']
  },
  steem: {
    kind: 'graphene',
    symbol: 'STEEM',
    urls: ['https://api.steemit.com']
  },
  sbd: {
    kind: 'graphene',
    symbol: 'SBD',
    urls: ['https://api.steemit.com']
  },
  pivx: {
    kind: 'blockbook',
    urls: ['https://explorer.duddino.com/api/v1/'],
    decimals: 8
  },
  znz: {
    kind: 'blockbook',
    urls: ['https://znzexplorer.alloyxuast.co.uk/api/v1/'],
    decimals: 8,
    unverified: true
  },
  fls: {
    kind: 'blockbook',
    urls: ['https://fls.flitswallet.app/api/v1/'],
    decimals: 8
  },
  eth: {
    kind: 'evm-blockbook',
    urls: ['https://ethbook.guarda.com/api'],
    decimals: 18
  },
  pol: {
    kind: 'evm-blockbook',
    urls: ['https://maticbook.guarda.com/api', 'https://pol1.trezor.io/api', 'https://pol2.trezor.io/api'],
    decimals: 18
  },
  bnb: {
    kind: 'evm-blockbook',
    urls: ['https://bscbook.guarda.com/api', 'https://bsc1.trezor.io/api', 'https://bsc2.trezor.io/api'],
    decimals: 18
  }
};

function normalizeTimestamp(value) {
  const numeric = Number(value || 0);
  return numeric > 1e12 ? Math.floor(numeric / 1000) : numeric;
}

function nearlyEqual(a, b, epsilon = 1e-8) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(normalizeBaseUrl))];
}

function normalizeLegacyArgs(timestamp, memo, minimumConfirmations) {
  // A couple of historic NekoLive routes used the old argument order:
  // existsTransaction(address, amount, memo, timestamp). Keep them compatible while
  // the rest of the application migrates to NekoPay's canonical order.
  if (typeof timestamp === 'string' && timestamp && !/^\d+(?:\.\d+)?$/.test(timestamp) && Number.isFinite(Number(memo))) {
    return {
      timestamp: Number(memo),
      memo: timestamp,
      minimumConfirmations: Number(minimumConfirmations || 0)
    };
  }
  if (typeof memo === 'number' && !minimumConfirmations) {
    return { timestamp, memo: null, minimumConfirmations: Number(memo) };
  }
  return { timestamp, memo, minimumConfirmations: Number(minimumConfirmations || 0) };
}

async function postRpc(url, method, params) {
  const response = await axios.post(url, {
    jsonrpc: '2.0',
    id: 1,
    method,
    params
  }, { timeout: DEFAULT_TIMEOUT });
  if (response.data?.error) {
    throw new Error(response.data.error.message || `RPC error from ${url}`);
  }
  return response.data?.result;
}

async function withFallback(urls, worker) {
  let lastError;
  for (const url of unique(urls)) {
    try {
      return await worker(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No payment verification endpoint is configured');
}

function parseAsset(value) {
  const match = String(value || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)\s+([A-Z0-9.]+)$/i);
  if (!match) return null;
  return { amount: Number(match[1]), symbol: match[2].toUpperCase() };
}

async function verifyGraphene(config, address, amount, timestamp, memo, minimumConfirmations) {
  const since = normalizeTimestamp(timestamp);
  return withFallback(config.urls, async (url) => {
    const history = await postRpc(url, 'condenser_api.get_account_history', [address, -1, 1000]);
    const rows = Array.isArray(history) ? history : [];
    let match = null;

    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]?.[1] || rows[index];
      const op = row?.op;
      if (!Array.isArray(op) || op[0] !== 'transfer') continue;
      const transfer = op[1] || {};
      if (String(transfer.to || '').toLowerCase() !== String(address || '').toLowerCase()) continue;
      const asset = parseAsset(transfer.amount);
      if (!asset || asset.symbol !== config.symbol) continue;
      if (!nearlyEqual(asset.amount, amount, 1e-6)) continue;
      if (memo && String(transfer.memo || '') !== String(memo)) continue;
      const txTime = Math.floor(new Date(`${row.timestamp || ''}Z`).getTime() / 1000);
      if (since && Number.isFinite(txTime) && txTime < since) continue;
      match = row;
      break;
    }

    if (!match) return { exists: false, txid: '', conf: 0 };

    let confirmations = Number(match.confirmations || 0);
    if (!confirmations && match.block) {
      try {
        const props = await postRpc(url, 'condenser_api.get_dynamic_global_properties', []);
        const head = Number(props?.head_block_number || props?.last_irreversible_block_num || 0);
        confirmations = head > Number(match.block) ? head - Number(match.block) + 1 : 1;
      } catch (_) {
        confirmations = 1;
      }
    }

    return {
      exists: confirmations >= Number(minimumConfirmations || 0),
      txid: match.trx_id || match.trxId || '',
      conf: confirmations,
      raw: match
    };
  });
}

function txTimestamp(tx) {
  return Number(tx?.blockTime || tx?.blocktime || tx?.time || tx?.timestamp || 0);
}

function confirmationsFor(tx) {
  return Number(tx?.confirmations ?? tx?.confirmation ?? 0);
}

function outputMatches(vout, address, amount, decimals) {
  const addresses = vout?.addresses || vout?.scriptPubKey?.addresses || (vout?.address ? [vout.address] : []);
  if (!addresses.map(String).some((item) => item.toLowerCase() === String(address).toLowerCase())) return false;
  const raw = vout?.value ?? vout?.valueSat ?? vout?.satoshis ?? 0;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return false;
  if (nearlyEqual(numeric, amount, 1e-8)) return true;
  return nearlyEqual(numeric / (10 ** decimals), amount, 1e-8);
}

async function fetchAddressTransactions(base, address) {
  const encoded = encodeURIComponent(address);
  const candidates = [
    `${base}/v2/address/${encoded}?details=txs&pageSize=1000`,
    `${base}/address/${encoded}?details=txs&pageSize=1000`,
    `${base}/v1/address/${encoded}?details=txs&pageSize=1000`
  ];
  let lastError;
  for (const url of candidates) {
    try {
      const { data } = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.transactions)) return data.transactions;
      if (Array.isArray(data?.txs)) return data.txs;
      if (Array.isArray(data?.items)) return data.items;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to read transactions for ${address}`);
}

async function hydrateTransaction(base, tx) {
  if (tx && typeof tx === 'object' && (tx.vout || tx.tokenTransfers || tx.to)) return tx;
  const txid = typeof tx === 'string' ? tx : tx?.txid || tx?.hash;
  if (!txid) return tx;
  const candidates = [`${base}/v2/tx/${txid}`, `${base}/tx/${txid}`, `${base}/v1/tx/${txid}`];
  for (const url of candidates) {
    try {
      const { data } = await axios.get(url, { timeout: DEFAULT_TIMEOUT });
      if (data) return data;
    } catch (_) {}
  }
  return tx;
}

async function verifyBlockbook(config, address, amount, timestamp, memo, minimumConfirmations) {
  const since = normalizeTimestamp(timestamp);
  return withFallback(config.urls, async (base) => {
    const refs = await fetchAddressTransactions(base, address);
    for (const ref of refs) {
      const tx = await hydrateTransaction(base, ref);
      const time = txTimestamp(tx);
      if (since && time && time < since) continue;
      const outputs = Array.isArray(tx?.vout) ? tx.vout : [];
      if (!outputs.some((out) => outputMatches(out, address, amount, Number(config.decimals || 8)))) continue;
      const conf = confirmationsFor(tx);
      return {
        exists: conf >= Number(minimumConfirmations || 0),
        txid: tx?.txid || tx?.hash || '',
        conf,
        raw: tx
      };
    }
    return { exists: false, txid: '', conf: 0 };
  });
}

function normalizeHexAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function atomicAmountMatches(rawValue, requested, decimals) {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw)) return false;
  return nearlyEqual(raw / (10 ** decimals), Number(requested), Math.max(1e-10, Number(requested) * 1e-9));
}

async function verifyEvmBlockbook(config, address, amount, timestamp, memo, minimumConfirmations, tokenContract) {
  const since = normalizeTimestamp(timestamp);
  const lowerAddress = normalizeHexAddress(address);
  const lowerContract = tokenContract ? normalizeHexAddress(tokenContract) : null;
  return withFallback(config.urls, async (base) => {
    const refs = await fetchAddressTransactions(base, address);
    for (const ref of refs) {
      const tx = await hydrateTransaction(base, ref);
      const time = txTimestamp(tx);
      if (since && time && time < since) continue;
      let matched = false;

      if (lowerContract) {
        matched = (tx?.tokenTransfers || []).some((transfer) => {
          const contract = normalizeHexAddress(transfer.token || transfer.contract || transfer.contractAddress);
          const to = normalizeHexAddress(transfer.to || transfer.toAddress);
          const decimals = Number(transfer.decimals ?? 18);
          return contract === lowerContract && to === lowerAddress
            && atomicAmountMatches(transfer.value ?? transfer.amount ?? 0, amount, decimals);
        });
      } else {
        const to = normalizeHexAddress(tx?.to || tx?.toAddress || tx?.ethereumSpecific?.to);
        const value = tx?.value ?? tx?.ethereumSpecific?.value;
        matched = to === lowerAddress && atomicAmountMatches(value ?? 0, amount, Number(config.decimals || 18));
        if (!matched && Array.isArray(tx?.vout)) {
          matched = tx.vout.some((out) => outputMatches(out, address, amount, Number(config.decimals || 18)));
        }
      }

      if (!matched) continue;
      const conf = confirmationsFor(tx);
      return {
        exists: conf >= Number(minimumConfirmations || 0),
        txid: tx?.txid || tx?.hash || '',
        conf,
        raw: tx
      };
    }
    return { exists: false, txid: '', conf: 0 };
  });
}

class ChainModule {
  constructor(chain, overrides = {}) {
    this.chain = String(chain || '').toLowerCase();
    const defaults = CHAIN_CONFIG[this.chain] || { kind: 'blockbook', urls: [] };
    const explicitUrls = [overrides.url, ...(overrides.altExplorerUrls || [])].filter(Boolean);
    this.config = {
      ...defaults,
      ...overrides,
      urls: unique(explicitUrls.length ? explicitUrls : defaults.urls)
    };
    this.tokenContract = overrides.tokenContract || null;
  }

  async existsTransaction(address, amount, timestamp, memo = null, minimumConfirmations = 0) {
    if (!address) throw new Error('Payment address/account is required');
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Payment amount must be greater than zero');
    const args = normalizeLegacyArgs(timestamp, memo, minimumConfirmations);
    if (this.config.unverified && !this.config.urls.length) {
      throw new Error(`${this.chain.toUpperCase()} has no configured explorer. Set an explorer URL explicitly.`);
    }
    if (this.config.kind === 'graphene') {
      return verifyGraphene(this.config, address, amount, args.timestamp, args.memo, args.minimumConfirmations);
    }
    if (this.config.kind === 'evm-blockbook') {
      return verifyEvmBlockbook(this.config, address, amount, args.timestamp, args.memo, args.minimumConfirmations, this.tokenContract);
    }
    return verifyBlockbook(this.config, address, amount, args.timestamp, args.memo, args.minimumConfirmations);
  }
}

function makeModule(chain) {
  return class extends ChainModule {
    constructor(overrides = {}) {
      super(chain, typeof overrides === 'object' && overrides ? overrides : {});
    }
  };
}

const exportsMap = {
  ChainModule,
  HIVEModule: makeModule('hive'),
  HBDModule: makeModule('hbd'),
  STEEMModule: makeModule('steem'),
  SBDModule: makeModule('sbd'),
  BLURTModule: makeModule('blurt'),
  PIVXModule: makeModule('pivx'),
  ZNZModule: makeModule('znz'),
  FLSModule: makeModule('fls'),
  ETHModule: makeModule('eth'),
  POLModule: makeModule('pol'),
  BNBModule: makeModule('bnb')
};

module.exports = exportsMap;
