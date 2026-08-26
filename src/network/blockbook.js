'use strict';

const MIN_INTERVAL_MS = Number(process.env.NEKOPAY_BLOCKBOOK_MIN_INTERVAL_MS || 250);
const MAX_RETRIES = Number(process.env.NEKOPAY_BLOCKBOOK_MAX_RETRIES || 3);
const TIMEOUT_MS = Number(process.env.NEKOPAY_BLOCKBOOK_TIMEOUT_MS || 20000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BlockbookClient {
  constructor(baseUrl) {
    const url = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('Blockbook URL must start with http:// or https://');
    this.baseUrl = url;
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
  }

  request(path, options = {}) {
    const run = async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      return this._fetchWithRetry(`${this.baseUrl}${path}`, options);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async _fetchWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(500 * (2 ** (attempt - 1)), 4000));
      let response;
      try {
        response = await fetch(url, {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NekoPay/2',
            ...(options.headers || {})
          },
          body: options.body,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch (error) {
        lastError = Object.assign(new Error(`network error reaching Blockbook: ${error.message}`), { status: 503 });
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error(`Blockbook refused access (HTTP ${response.status})`), { status: response.status });
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120) {
          await sleep(retryAfter * 1000);
        }
        lastError = Object.assign(new Error(`Blockbook HTTP ${response.status}`), { status: response.status });
        continue;
      }

      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        throw Object.assign(new Error(`Blockbook returned non-JSON (HTTP ${response.status})`), { status: 502 });
      }
      if (!response.ok || body?.error) {
        throw Object.assign(new Error(body?.error || `Blockbook HTTP ${response.status}`), { status: response.status });
      }
      return body;
    }
    throw lastError || Object.assign(new Error('Blockbook request failed'), { status: 503 });
  }

  status() {
    return this.request('/api/v2');
  }

  address(address, { page = 1, pageSize = 50, details = 'txs' } = {}) {
    return this.request(`/api/v2/address/${encodeURIComponent(address)}?details=${encodeURIComponent(details)}&page=${page}&pageSize=${pageSize}`);
  }

  utxo(address, { confirmed = false } = {}) {
    return this.request(`/api/v2/utxo/${encodeURIComponent(address)}?confirmed=${confirmed ? 'true' : 'false'}`);
  }

  tx(txid) {
    return this.request(`/api/v2/tx/${encodeURIComponent(txid)}`);
  }

  async txHex(txid) {
    const transaction = await this.tx(txid);
    if (!transaction?.hex) throw new Error(`Blockbook did not return raw transaction hex for ${txid}`);
    return transaction.hex;
  }

  async estimateFee(blocks = 5) {
    const result = await this.request(`/api/v2/estimatefee/${Math.max(1, Number(blocks) || 5)}`);
    return result?.result;
  }

  async broadcast(rawHex) {
    const hex = String(rawHex || '').trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw Object.assign(new Error('Raw transaction must be hex'), { status: 400 });
    return this.request('/api/v2/sendtx/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: hex
    }).then((body) => body?.result || body?.txid || body);
  }
}

module.exports = { BlockbookClient };
