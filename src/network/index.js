'use strict';

const { BackendPool } = require('./backend-pool');
const { BlockbookClient } = require('./blockbook');
const { EvmRpcClient } = require('./evm-rpc');
const { EvmExplorer, hasExplorer, unavailable } = require('./explorer');
const backends = require('./backends');

const pools = new Map();

function poolKey(symbol, pinnedUrl) {
  return `${backends.canonicalSymbol(symbol)}:${pinnedUrl || 'auto'}`;
}

function createPool(symbol, pinnedUrl = null) {
  const config = backends.getBackendConfig(symbol);
  if (!config.backends.length && !pinnedUrl) {
    throw Object.assign(new Error(`No ${config.symbol} backend is configured`), { status: 503 });
  }

  const build = config.kind === 'evmrpc'
    ? (url) => new EvmRpcClient(url, config.chainId)
    : (url) => new BlockbookClient(url);
  const verify = (client) => client.status();
  const pool = new BackendPool({
    label: config.symbol,
    build,
    verify,
    missing: `No ${config.symbol} ${config.kind === 'evmrpc' ? 'RPC' : 'Blockbook'} backend is configured`
  }).setCandidates(config.backends);

  if (pinnedUrl) pool.pin(pinnedUrl);
  return pool;
}

function getPool(symbol, { url = null } = {}) {
  const key = poolKey(symbol, url);
  if (!pools.has(key)) pools.set(key, createPool(symbol, url));
  return pools.get(key);
}

async function getBackendStatus(symbol, options = {}) {
  const pool = getPool(symbol, options);
  await pool.resolve();
  return {
    config: backends.getBackendConfig(symbol),
    summary: pool.summary(),
    health: pool.health()
  };
}

async function read(symbol, worker, options = {}) {
  return getPool(symbol, options).read(worker);
}

async function broadcast(symbol, worker, options = {}) {
  return getPool(symbol, options).broadcast(worker);
}

function getExplorer(symbol) {
  const key = backends.canonicalSymbol(symbol);
  if (!hasExplorer(key)) throw Object.assign(new Error(unavailable(key)), { status: 503 });
  return new EvmExplorer(key);
}

function resetPools() {
  pools.clear();
}

module.exports = {
  ...backends,
  BackendPool,
  BlockbookClient,
  EvmRpcClient,
  EvmExplorer,
  getPool,
  getBackendStatus,
  getExplorer,
  read,
  broadcast,
  resetPools
};
