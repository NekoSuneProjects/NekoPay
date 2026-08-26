'use strict';

const axios = require('axios');

const TIMEOUT = Number(process.env.NEKOPAY_CHAIN_TIMEOUT_MS || 12000);
const NETWORKS = {
  tlos: { symbol: 'TLOS', history: 'https://mainnet.telos.net/v2/history/get_actions', chain: 'https://telos.greymass.com' },
  eos: { symbol: 'EOS', history: 'https://eos.hyperion.eosrio.io/v2/history/get_actions', chain: 'https://eos.greymass.com' },
  wax: { symbol: 'WAX', history: 'https://wax.eosrio.io/v2/history/get_actions', chain: 'https://wax.greymass.com' },
  fio: { symbol: 'FIO', history: 'https://fio.greymass.com/v1/history/get_actions', chain: 'https://fio.greymass.com' }
};

function parseQuantity(value) {
  const match = String(value || '').match(/^([0-9]+(?:\.[0-9]+)?)\s+([A-Z0-9.]+)$/i);
  return match ? { amount: Number(match[1]), symbol: match[2].toUpperCase() } : null;
}

function normalizeTimestamp(value) {
  const number = Number(value || 0);
  return number > 1e12 ? Math.floor(number / 1000) : number;
}

class AntelopeModule {
  constructor(network, overrides = {}) {
    this.network = network;
    this.config = { ...NETWORKS[network], ...overrides };
  }

  async existsTransaction(address, amount, timestamp, memo = null, minimumConfirmations = 0) {
    if (typeof timestamp === 'string' && timestamp && !/^\d+$/.test(timestamp) && Number.isFinite(Number(memo))) {
      [timestamp, memo] = [memo, timestamp];
    }
    const since = normalizeTimestamp(timestamp);
    const historyUrl = this.config.antelopeHistoryUrl || this.config.history;
    const response = await axios.get(historyUrl, {
      timeout: TIMEOUT,
      params: { account: address, limit: 100, sort: 'desc', simple: false }
    });
    const actions = response.data?.actions || response.data?.simple_actions || response.data?.results || [];
    const match = actions.find((entry) => {
      const action = entry.act || entry.action_trace?.act || entry.action || {};
      const data = action.data || entry.data || {};
      const quantity = parseQuantity(data.quantity || data.amount);
      const time = Math.floor(new Date(entry['@timestamp'] || entry.timestamp || entry.block_time || 0).getTime() / 1000);
      return String(action.name || entry.name || '').toLowerCase() === 'transfer'
        && String(data.to || '').toLowerCase() === String(address || '').toLowerCase()
        && quantity && quantity.symbol === this.config.symbol
        && Math.abs(quantity.amount - Number(amount)) <= 1e-8
        && (!memo || String(data.memo || '') === String(memo))
        && (!since || !time || time >= since);
    });
    if (!match) return { exists: false, txid: '', conf: 0 };

    let conf = Number(match.confirmations || 0);
    if (!conf && match.block_num) {
      try {
        const info = await axios.post(`${String(this.config.chain).replace(/\/+$/, '')}/v1/chain/get_info`, {}, { timeout: TIMEOUT });
        const head = Number(info.data?.head_block_num || info.data?.last_irreversible_block_num || 0);
        conf = head >= Number(match.block_num) ? head - Number(match.block_num) + 1 : 1;
      } catch (_) { conf = 1; }
    }
    return {
      exists: conf >= Number(minimumConfirmations || 0),
      txid: match.trx_id || match.transaction_id || match.action_trace?.trx_id || '',
      conf,
      raw: match
    };
  }
}

function moduleFor(network) {
  return class extends AntelopeModule { constructor(overrides = {}) { super(network, overrides); } };
}

module.exports = {
  TLOSModule: moduleFor('tlos'),
  EOSModule: moduleFor('eos'),
  FIOModule: moduleFor('fio'),
  WAXModule: moduleFor('wax')
};
