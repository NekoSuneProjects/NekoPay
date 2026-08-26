'use strict';

const fs = require('fs');

// Seeded from CryptoWallet's endpoint verification pass (2026-08-23). These are
// fallbacks, not guarantees: public nodes can disappear or rate-limit at any time.
// Merchants can override every symbol with NEKOPAY_<SYMBOL>_BACKEND_URLS or supply
// NEKOPAY_BACKENDS_FILE with the same object shape.
const BUILTIN = {
  BTC: {
    kind: 'blockbook',
    backends: [
      ['https://blockbook.btc.zelcore.io', 'Zelcore'],
      ['https://bitcoin.atomicwallet.io', 'Atomic Wallet'],
      ['https://btc.flitswallet.app', 'Flits']
    ]
  },
  LTC: {
    kind: 'blockbook',
    backends: [
      ['https://blockbook.ltc.zelcore.io', 'Zelcore'],
      ['https://litecoinblockexplorer.net', 'NOWNodes community'],
      ['https://litecoin.atomicwallet.io', 'Atomic Wallet'],
      ['https://ltc.flitswallet.app', 'Flits']
    ]
  },
  DOGE: {
    kind: 'blockbook',
    backends: [
      ['https://blockbook.doge.zelcore.io', 'Zelcore'],
      ['https://doge.flitswallet.app', 'Flits']
    ]
  },
  DASH: { kind: 'blockbook', backends: [['https://dash.atomicwallet.io', 'Atomic Wallet']] },
  DGB: { kind: 'blockbook', backends: [['https://blockbook.dgb.zelcore.io', 'Zelcore']] },
  PIVX: { kind: 'blockbook', backends: [['https://explorer.pivxla.bz', 'pivxla.bz']] },
  FLS: { kind: 'blockbook', backends: [['https://fls.flitswallet.app', 'Flits']] },
  '777': { kind: 'blockbook', backends: [['https://777.flitswallet.app', 'Flits']] },
  AZR: { kind: 'blockbook', backends: [['https://azr.flitswallet.app', 'Flits']] },
  BECN: { kind: 'blockbook', backends: [['https://becn.flitswallet.app', 'Flits']] },
  BIR: { kind: 'blockbook', backends: [['https://bir.flitswallet.app', 'Flits']] },
  KYAN: { kind: 'blockbook', backends: [['https://kyan.flitswallet.app', 'Flits']] },
  PNY: { kind: 'blockbook', backends: [['https://pny.flitswallet.app', 'Flits']] },
  SAPP: { kind: 'blockbook', backends: [['https://sapp.flitswallet.app', 'Flits']] },

  ETH: { kind: 'evmrpc', chainId: 1, backends: [
    ['https://ethereum-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/eth-mainnet', 'ZAN'],
    ['https://eth.drpc.org', 'dRPC'],
    ['https://ethereum.public.blockpi.network/v1/rpc/public', 'BlockPI'],
    ['https://mainnet.gateway.tenderly.co', 'Tenderly']
  ] },
  ETC: { kind: 'evmrpc', chainId: 61, backends: [
    ['https://etc.etcdesktop.com', 'ETC Desktop'],
    ['https://0xrpc.io/etc', '0xRPC'],
    ['https://geth-at.etc-network.info', 'etc-network.info'],
    ['https://etc.rivet.link', 'Rivet']
  ] },
  BSC: { kind: 'evmrpc', chainId: 56, aliases: ['BNB'], backends: [
    ['https://bsc-rpc.publicnode.com', 'PublicNode'],
    ['https://bsc-dataseed1.bnbchain.org', 'BNB Chain'],
    ['https://bsc-dataseed2.bnbchain.org', 'BNB Chain'],
    ['https://api.zan.top/bsc-mainnet', 'ZAN'],
    ['https://bsc-mainnet.public.blastapi.io', 'Bware Labs']
  ] },
  POL: { kind: 'evmrpc', chainId: 137, backends: [
    ['https://polygon-bor-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/polygon-mainnet', 'ZAN'],
    ['https://polygon.drpc.org', 'dRPC'],
    ['https://polygon.gateway.tenderly.co', 'Tenderly'],
    ['https://polygon.lava.build', 'Lava Network']
  ] },
  ARB: { kind: 'evmrpc', chainId: 42161, aliases: ['ARBITRUM'], backends: [
    ['https://arb1.arbitrum.io/rpc', 'Offchain Labs'],
    ['https://arbitrum-one-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/arb-one', 'ZAN'],
    ['https://arbitrum.drpc.org', 'dRPC']
  ] },
  OP: { kind: 'evmrpc', chainId: 10, aliases: ['OPTIMISM'], backends: [
    ['https://mainnet.optimism.io', 'OP Labs'],
    ['https://optimism-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/opt-mainnet', 'ZAN'],
    ['https://optimism.drpc.org', 'dRPC']
  ] },
  BASE: { kind: 'evmrpc', chainId: 8453, backends: [
    ['https://mainnet.base.org', 'Coinbase'],
    ['https://base-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/base-mainnet', 'ZAN'],
    ['https://base.drpc.org', 'dRPC']
  ] },
  AVAX: { kind: 'evmrpc', chainId: 43114, aliases: ['AVALANCHE'], backends: [
    ['https://api.avax.network/ext/bc/C/rpc', 'Ava Labs'],
    ['https://avalanche-c-chain-rpc.publicnode.com', 'PublicNode'],
    ['https://api.zan.top/avax-mainnet/ext/bc/C/rpc', 'ZAN'],
    ['https://avalanche.drpc.org', 'dRPC']
  ] },
  GNO: { kind: 'evmrpc', chainId: 100, aliases: ['GNOSIS'], backends: [
    ['https://rpc.gnosischain.com', 'Gnosis Chain'],
    ['https://gnosis-rpc.publicnode.com', 'PublicNode'],
    ['https://gnosis.drpc.org', 'dRPC']
  ] },
  CRO: { kind: 'evmrpc', chainId: 25, aliases: ['CRONOS'], backends: [
    ['https://evm.cronos.org', 'Cronos Labs'],
    ['https://cronos-evm-rpc.publicnode.com', 'PublicNode'],
    ['https://cronos.drpc.org', 'dRPC'],
    ['https://rpc.vvs.finance', 'VVS Finance']
  ] },
  LINEA: { kind: 'evmrpc', chainId: 59144, backends: [
    ['https://rpc.linea.build', 'Consensys'],
    ['https://linea-rpc.publicnode.com', 'PublicNode'],
    ['https://linea.drpc.org', 'dRPC']
  ] },
  SCROLL: { kind: 'evmrpc', chainId: 534352, backends: [
    ['https://rpc.scroll.io', 'Scroll'],
    ['https://scroll-rpc.publicnode.com', 'PublicNode'],
    ['https://scroll.drpc.org', 'dRPC']
  ] },
  BLAST: { kind: 'evmrpc', chainId: 81457, backends: [
    ['https://rpc.blast.io', 'Blast'],
    ['https://blast-rpc.publicnode.com', 'PublicNode'],
    ['https://blast.drpc.org', 'dRPC']
  ] },
  ZKSYNC: { kind: 'evmrpc', chainId: 324, aliases: ['ZKSYNCERA'], backends: [
    ['https://mainnet.era.zksync.io', 'Matter Labs'],
    ['https://zksync.drpc.org', 'dRPC'],
    ['https://api.zan.top/zksync-mainnet', 'ZAN']
  ] },
  OPBNB: { kind: 'evmrpc', chainId: 204, backends: [
    ['https://opbnb-mainnet-rpc.bnbchain.org', 'BNB Chain'],
    ['https://opbnb-rpc.publicnode.com', 'PublicNode'],
    ['https://opbnb.drpc.org', 'dRPC']
  ] },
  MNT: { kind: 'evmrpc', chainId: 5000, aliases: ['MANTLE'], backends: [
    ['https://rpc.mantle.xyz', 'Mantle'],
    ['https://mantle-rpc.publicnode.com', 'PublicNode'],
    ['https://mantle.drpc.org', 'dRPC']
  ] },
  CELO: { kind: 'evmrpc', chainId: 42220, backends: [
    ['https://forno.celo.org', 'cLabs'],
    ['https://celo-json-rpc.stakely.io', 'Stakely'],
    ['https://rpc.ankr.com/celo', 'Ankr']
  ] },
  SONIC: { kind: 'evmrpc', chainId: 146, backends: [
    ['https://rpc.soniclabs.com', 'Sonic Labs'],
    ['https://sonic-rpc.publicnode.com', 'PublicNode'],
    ['https://sonic.drpc.org', 'dRPC']
  ] },
  THETA: { kind: 'evmrpc', chainId: 361, backends: [
    ['https://eth-rpc-api.thetatoken.org/rpc', 'Theta Labs']
  ] },
  BTTC: { kind: 'evmrpc', chainId: 199, backends: [
    ['https://rpc.bittorrentchain.io', 'BitTorrent Chain'],
    ['https://rpc.bt.io', 'BitTorrent Chain'],
    ['https://bittorrent.drpc.org', 'dRPC']
  ] }
};

let customCache = null;
function loadCustom() {
  if (customCache) return customCache;
  const file = String(process.env.NEKOPAY_BACKENDS_FILE || '').trim();
  if (!file) return (customCache = {});
  try {
    customCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`NekoPay backend file could not be loaded: ${error.message}`);
    customCache = {};
  }
  return customCache;
}

function normalizeEntry(entry, fallbackKind) {
  if (typeof entry === 'string') return { url: entry.replace(/\/+$/, ''), operator: 'configured', kind: fallbackKind };
  if (Array.isArray(entry)) return { url: String(entry[0]).replace(/\/+$/, ''), operator: entry[1] || 'unknown', kind: fallbackKind };
  return {
    url: String(entry?.url || '').replace(/\/+$/, ''),
    operator: entry?.operator || 'unknown',
    note: entry?.note || '',
    kind: entry?.kind || fallbackKind
  };
}

function canonicalSymbol(symbol) {
  const requested = String(symbol || '').trim().toUpperCase();
  if (BUILTIN[requested]) return requested;
  for (const [key, config] of Object.entries(BUILTIN)) {
    if ((config.aliases || []).includes(requested)) return key;
  }
  return requested;
}

function getBackendConfig(symbol) {
  const key = canonicalSymbol(symbol);
  const builtin = BUILTIN[key] || { kind: 'blockbook', backends: [] };
  const custom = loadCustom()[key] || loadCustom()[String(symbol || '').toUpperCase()] || {};
  const envValue = process.env[`NEKOPAY_${key}_BACKEND_URLS`] || '';
  const envBackends = envValue.split(',').map((value) => value.trim()).filter(Boolean);
  const customBackends = Array.isArray(custom) ? custom : (custom.backends || []);
  const source = envBackends.length ? envBackends : [...customBackends, ...(builtin.backends || [])];
  const seen = new Set();
  const backends = source
    .map((entry) => normalizeEntry(entry, custom.kind || builtin.kind))
    .filter((entry) => entry.url && !seen.has(entry.url) && seen.add(entry.url));

  return {
    symbol: key,
    kind: custom.kind || builtin.kind,
    chainId: custom.chainId ?? builtin.chainId ?? null,
    backends
  };
}

function symbols() {
  return Object.keys(BUILTIN).sort();
}

module.exports = {
  BUILTIN,
  getBackendConfig,
  canonicalSymbol,
  symbols,
  verifiedAt: '2026-08-23'
};
