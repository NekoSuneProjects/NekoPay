'use strict';

const MIN_INTERVAL_MS = Number(process.env.NEKOPAY_EVMRPC_MIN_INTERVAL_MS || 150);
const MAX_RETRIES = Number(process.env.NEKOPAY_EVMRPC_MAX_RETRIES || 3);
const TIMEOUT_MS = Number(process.env.NEKOPAY_EVMRPC_TIMEOUT_MS || 20000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class EvmRpcClient {
  constructor(url, expectedChainId = null) {
    if (!url) throw Object.assign(new Error('EVM RPC URL is required'), { status: 400 });
    this.baseUrl = String(url).trim().replace(/\/+$/, '');
    this.expectedChainId = expectedChainId == null ? null : Number(expectedChainId);
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
    this.id = 0;
  }

  call(method, params = []) {
    const run = async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      try {
        return await this._attempt(method, params);
      } finally {
        this.lastRequestAt = Date.now();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async _attempt(method, params) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(500 * (2 ** (attempt - 1)), 4000));
      let response;
      try {
        response = await fetch(this.baseUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'NekoPay/2'
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params })
        });
      } catch (error) {
        lastError = Object.assign(new Error(`network error reaching EVM RPC: ${error.message}`), { status: 503 });
        continue;
      }

      if ([401, 403].includes(response.status)) {
        throw Object.assign(new Error(`EVM RPC refused access (HTTP ${response.status})`), { status: response.status });
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120) await sleep(retryAfter * 1000);
        lastError = Object.assign(new Error(`EVM RPC HTTP ${response.status}`), { status: response.status });
        continue;
      }

      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        lastError = Object.assign(new Error(`EVM RPC returned non-JSON (HTTP ${response.status})`), { status: 502 });
        continue;
      }
      if (body?.error) throw Object.assign(new Error(`RPC ${method} failed: ${body.error.message}`), { status: 400, rpcCode: body.error.code });
      return body?.result;
    }
    throw lastError || Object.assign(new Error('EVM RPC request failed'), { status: 503 });
  }

  async chainId() { return Number(BigInt(await this.call('eth_chainId'))); }
  async blockNumber() { return Number(BigInt(await this.call('eth_blockNumber'))); }
  async balance(address, tag = 'latest') { return BigInt(await this.call('eth_getBalance', [address, tag])); }
  async gasPrice() { return BigInt(await this.call('eth_gasPrice')); }
  async nonce(address, tag = 'pending') { return Number(BigInt(await this.call('eth_getTransactionCount', [address, tag]))); }
  async sendRaw(rawHex) { return this.call('eth_sendRawTransaction', [rawHex]); }
  async receipt(txid) { return this.call('eth_getTransactionReceipt', [txid]); }
  async transaction(txid) { return this.call('eth_getTransactionByHash', [txid]); }
  async block(numberOrTag = 'latest', full = false) {
    const value = typeof numberOrTag === 'number' ? `0x${numberOrTag.toString(16)}` : numberOrTag;
    return this.call('eth_getBlockByNumber', [value, Boolean(full)]);
  }
  async logs(filter) { return this.call('eth_getLogs', [filter]); }
  async ethCall(to, data, from) {
    const tx = { to, data };
    if (from) tx.from = from;
    return this.call('eth_call', [tx, 'latest']);
  }
  async estimateGas(tx) { return BigInt(await this.call('eth_estimateGas', [tx])); }
  async baseFee() {
    const block = await this.block('latest', false);
    return block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : null;
  }
  async priorityFee() {
    try {
      return BigInt(await this.call('eth_maxPriorityFeePerGas'));
    } catch (_) {
      return 1000000000n;
    }
  }

  async status() {
    const [chainId, blockNumber, gasPriceWei] = await Promise.all([
      this.chainId(),
      this.blockNumber(),
      this.gasPrice()
    ]);
    if (this.expectedChainId != null && chainId !== this.expectedChainId) {
      throw Object.assign(new Error(`RPC chain id ${chainId} does not match expected ${this.expectedChainId}`), { status: 503 });
    }
    return { chainId, blockNumber, gasPriceWei: gasPriceWei.toString() };
  }
}

module.exports = { EvmRpcClient };
