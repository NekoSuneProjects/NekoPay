'use strict';

const axios = require('axios');

const DEFAULT_TRON_API_URL = 'https://api.trongrid.io';
const DEFAULT_TIMEOUT_MS = Number(process.env.NEKOPAY_TRON_TIMEOUT_MS || 15000);
const MAX_PAGES = Math.max(1, Math.min(10, Number(process.env.NEKOPAY_TRON_MAX_PAGES || 5)));

function decimalToUnits(value, decimals) {
  const text = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new Error('Invalid TRON payment amount');
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(`${whole}${(fraction + '0'.repeat(decimals)).slice(0, decimals)}`);
}

function normalizeTimestampMs(value) {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function tronHeaders() {
  const apiKey = String(process.env.TRON_PRO_API_KEY || '').trim();
  return apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
}

function tronApiUrl() {
  return String(process.env.TRON_API_URL || DEFAULT_TRON_API_URL).replace(/\/+$/, '');
}

function assertTronAddress(address, label = 'TRON address') {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(address || '').trim())) {
    throw new Error(`Invalid ${label}`);
  }
}

async function *accountPages(path, params = {}) {
  let fingerprint = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await axios.get(`${tronApiUrl()}${path}`, {
      headers: tronHeaders(),
      params: {
        ...params,
        ...(fingerprint ? { fingerprint } : {})
      },
      timeout: DEFAULT_TIMEOUT_MS
    });

    const transactions = Array.isArray(data?.data) ? data.data : [];
    yield transactions;

    fingerprint = data?.meta?.fingerprint || null;
    if (!fingerprint || transactions.length === 0) break;
  }
}

function completedResult(transaction, minimumConfirmations) {
  const conf = 1; // TronGrid only_confirmed=true means the transaction is in a confirmed block.
  return {
    exists: conf >= Number(minimumConfirmations || 0),
    txid: transaction?.transaction_id || transaction?.txID || '',
    conf,
    raw: transaction
  };
}

async function verifyTrc20(address, expectedUnits, sinceMs, tokenConfig, minimumConfirmations) {
  assertTronAddress(tokenConfig.contract, 'TRC-20 contract address');
  const path = `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`;
  const params = {
    only_confirmed: true,
    only_to: true,
    limit: 200,
    order_by: 'block_timestamp,desc',
    contract_address: tokenConfig.contract,
    ...(sinceMs ? { min_timestamp: sinceMs } : {})
  };

  for await (const transactions of accountPages(path, params)) {
    for (const transaction of transactions) {
      const timestamp = Number(transaction?.block_timestamp || 0);
      if (sinceMs && timestamp && timestamp < sinceMs) continue;
      if (String(transaction?.to || '') !== String(address)) continue;
      if (!/^\d+$/.test(String(transaction?.value ?? ''))) continue;
      if (BigInt(String(transaction.value)) !== expectedUnits) continue;
      return completedResult(transaction, minimumConfirmations);
    }
  }

  return { exists: false, txid: '', conf: 0 };
}

function nativeTransferAmount(transaction) {
  for (const contract of transaction?.raw_data?.contract || []) {
    if (contract?.type !== 'TransferContract') continue;
    const amount = contract?.parameter?.value?.amount;
    if (amount != null && /^\d+$/.test(String(amount))) {
      return BigInt(String(amount));
    }
  }
  return null;
}

async function verifyNativeTrx(address, expectedUnits, sinceMs, minimumConfirmations) {
  const path = `/v1/accounts/${encodeURIComponent(address)}/transactions`;
  const params = {
    only_confirmed: true,
    only_to: true,
    limit: 200,
    order_by: 'block_timestamp,desc',
    ...(sinceMs ? { min_timestamp: sinceMs } : {})
  };

  for await (const transactions of accountPages(path, params)) {
    for (const transaction of transactions) {
      const timestamp = Number(transaction?.block_timestamp || transaction?.raw_data?.timestamp || 0);
      if (sinceMs && timestamp && timestamp < sinceMs) continue;
      if (nativeTransferAmount(transaction) !== expectedUnits) continue;
      return completedResult(transaction, minimumConfirmations);
    }
  }

  return { exists: false, txid: '', conf: 0 };
}

async function existsTronTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 1) {
  assertTronAddress(address);
  const decimals = Number(tokenConfig.decimals ?? 6);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error('Invalid TRON token decimals');
  }

  const expectedUnits = decimalToUnits(amount, decimals);
  if (expectedUnits <= 0n) throw new Error('TRON payment amount must be greater than zero');
  const sinceMs = normalizeTimestampMs(createdAt);

  if (tokenConfig.contract) {
    return verifyTrc20(address, expectedUnits, sinceMs, tokenConfig, minimumConfirmations);
  }
  return verifyNativeTrx(address, expectedUnits, sinceMs, minimumConfirmations);
}

module.exports = {
  existsTronTransaction,
  decimalToUnits,
  normalizeTimestampMs
};
