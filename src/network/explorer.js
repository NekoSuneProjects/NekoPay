'use strict';

const MIN_INTERVAL_MS = Number(process.env.NEKOPAY_EXPLORER_MIN_INTERVAL_MS || 350);
const MAX_RETRIES = Number(process.env.NEKOPAY_EXPLORER_MAX_RETRIES || 2);
const TIMEOUT_MS = Number(process.env.NEKOPAY_EXPLORER_TIMEOUT_MS || 20000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EXPLORERS = {
  ETH: { kind: 'blockscout', url: 'https://eth.blockscout.com', operator: 'Blockscout' },
  POL: { kind: 'blockscout', url: 'https://polygon.blockscout.com', operator: 'Blockscout' },
  BASE: { kind: 'blockscout', url: 'https://base.blockscout.com', operator: 'Blockscout' },
  OP: { kind: 'blockscout', url: 'https://optimism.blockscout.com', operator: 'Blockscout' },
  ARB: { kind: 'blockscout', url: 'https://arbitrum.blockscout.com', operator: 'Blockscout' },
  GNO: { kind: 'blockscout', url: 'https://gnosis.blockscout.com', operator: 'Blockscout' },
  ETC: { kind: 'blockscout', url: 'https://etc.blockscout.com', operator: 'Blockscout' },
  CELO: { kind: 'blockscout', url: 'https://celo.blockscout.com', operator: 'Blockscout' },
  SCROLL: { kind: 'blockscout', url: 'https://scroll.blockscout.com', operator: 'Blockscout' },
  ZKSYNC: { kind: 'blockscout', url: 'https://zksync.blockscout.com', operator: 'Blockscout' },
  AVAX: { kind: 'routescan', url: 'https://api.routescan.io', chainId: 43114, operator: 'Routescan' },
  BLAST: { kind: 'routescan', url: 'https://api.routescan.io', chainId: 81457, operator: 'Routescan' },
  MNT: { kind: 'routescan', url: 'https://api.routescan.io', chainId: 5000, operator: 'Routescan' }
};

const NO_SOURCE = {
  BSC: 'No keyless Blockscout/Routescan address-history source is currently available; BscScan requires a key.',
  CRO: 'No keyless Blockscout/Routescan address-history source is currently available for Cronos.',
  LINEA: 'No keyless Blockscout/Routescan address-history source is currently available for Linea.',
  OPBNB: 'No keyless Blockscout/Routescan address-history source is currently available for opBNB.',
  SONIC: 'No keyless Blockscout/Routescan address-history source is currently available for Sonic.',
  THETA: 'Theta has no documented keyless address-history API suitable for NekoPay.',
  BTTC: 'BitTorrent Chain has no keyless address-history API suitable for NekoPay.'
};

function unavailable(symbol) {
  const key = String(symbol || '').toUpperCase();
  return `No keyless indexed transaction-history source is configured for ${key}. ${NO_SOURCE[key] || ''}`.trim();
}

class EvmExplorer {
  constructor(symbol, config = EXPLORERS[String(symbol || '').toUpperCase()]) {
    if (!config) throw Object.assign(new Error(unavailable(symbol)), { status: 503 });
    this.symbol = String(symbol || '').toUpperCase();
    this.kind = config.kind;
    this.operator = config.operator;
    this.chainId = config.chainId || null;
    this.baseUrl = String(config.url).replace(/\/+$/, '');
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
  }

  get(path) {
    const run = async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      try {
        return await this._attempt(path);
      } finally {
        this.lastRequestAt = Date.now();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async _attempt(path) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(600 * (2 ** (attempt - 1)), 4000));
      let response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Accept: 'application/json', 'User-Agent': 'NekoPay/2' }
        });
      } catch (error) {
        lastError = Object.assign(new Error(`network error reaching ${this.operator}: ${error.message}`), { status: 502 });
        continue;
      }
      if ([401, 403].includes(response.status)) throw Object.assign(new Error(`${this.operator} refused this request`), { status: response.status });
      if (response.status === 404) throw Object.assign(new Error(`${this.operator} has no such record`), { status: 404 });
      if (response.status === 429 || response.status >= 500) {
        lastError = Object.assign(new Error(`${this.operator} returned HTTP ${response.status}`), { status: response.status });
        continue;
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        lastError = Object.assign(new Error(`${this.operator} returned non-JSON`), { status: 502 });
      }
    }
    throw lastError || Object.assign(new Error(`${this.operator} request failed`), { status: 503 });
  }

  async transactions(address, { cursor = null, limit = 50 } = {}) {
    if (this.kind === 'blockscout') {
      const qs = cursor ? `?${new URLSearchParams(JSON.parse(cursor))}` : '';
      const body = await this.get(`/api/v2/addresses/${encodeURIComponent(address)}/transactions${qs}`);
      const rows = Array.isArray(body?.items) ? body.items : [];
      return {
        source: { operator: this.operator, kind: this.kind, url: this.baseUrl },
        transactions: rows.slice(0, limit).map((tx) => ({
          txid: tx.hash,
          blockHeight: tx.block_number || null,
          confirmations: Number(tx.confirmations || 0),
          timestamp: tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : null,
          from: tx.from?.hash || null,
          to: tx.to?.hash || null,
          value: String(tx.value || '0'),
          success: tx.block_number ? (tx.status ? tx.status === 'ok' : tx.result === 'success') : null,
          pending: !tx.block_number,
          method: tx.method || null
        })),
        next: body?.next_page_params ? JSON.stringify(body.next_page_params) : null
      };
    }

    const page = cursor ? Number(cursor) : 1;
    const query = new URLSearchParams({
      module: 'account',
      action: 'txlist',
      address,
      page: String(page),
      offset: String(Math.min(100, Math.max(1, Number(limit) || 50))),
      sort: 'desc'
    });
    const body = await this.get(`/v2/network/mainnet/evm/${this.chainId}/etherscan/api?${query}`);
    const rows = Array.isArray(body?.result) ? body.result : [];
    return {
      source: { operator: this.operator, kind: this.kind, url: 'https://routescan.io' },
      transactions: rows.map((tx) => ({
        txid: tx.hash,
        blockHeight: Number(tx.blockNumber) || null,
        confirmations: Number(tx.confirmations || 0),
        timestamp: Number(tx.timeStamp) || null,
        from: tx.from || null,
        to: tx.to || null,
        value: String(tx.value || '0'),
        success: tx.txreceipt_status ? tx.txreceipt_status === '1' : tx.isError === '0',
        pending: false,
        method: tx.functionName || null
      })),
      next: rows.length >= Math.min(100, Math.max(1, Number(limit) || 50)) ? String(page + 1) : null
    };
  }

  async tokenBalances(address) {
    if (this.kind === 'blockscout') {
      const body = await this.get(`/api/v2/addresses/${encodeURIComponent(address)}/token-balances`);
      const rows = Array.isArray(body) ? body : [];
      return {
        source: { operator: this.operator, kind: this.kind, url: this.baseUrl },
        tokens: rows
          .filter((row) => !row.token || String(row.token.type || '').toUpperCase() === 'ERC-20')
          .map((row) => ({
            contract: row.token?.address_hash || row.token?.address || null,
            symbol: row.token?.symbol || '(unknown)',
            name: row.token?.name || '(unknown)',
            decimals: Number(row.token?.decimals || 18),
            balance: String(row.value || '0'),
            suspicious: Boolean(row.token?.reputation && !['ok', 'neutral'].includes(String(row.token.reputation).toLowerCase()))
          }))
      };
    }

    const query = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      address,
      page: '1',
      offset: '100',
      sort: 'desc'
    });
    const body = await this.get(`/v2/network/mainnet/evm/${this.chainId}/etherscan/api?${query}`);
    const rows = Array.isArray(body?.result) ? body.result : [];
    const map = new Map();
    for (const row of rows) {
      const contract = String(row.contractAddress || '').toLowerCase();
      if (!contract || map.has(contract)) continue;
      map.set(contract, {
        contract: row.contractAddress,
        symbol: row.tokenSymbol || '(unknown)',
        name: row.tokenName || '(unknown)',
        decimals: Number(row.tokenDecimal || 18),
        balance: null,
        suspicious: false
      });
    }
    return { source: { operator: this.operator, kind: this.kind, url: 'https://routescan.io' }, tokens: [...map.values()] };
  }
}

function hasExplorer(symbol) {
  return Boolean(EXPLORERS[String(symbol || '').toUpperCase()]);
}

module.exports = {
  EvmExplorer,
  EXPLORERS,
  NO_SOURCE,
  unavailable,
  hasExplorer
};
