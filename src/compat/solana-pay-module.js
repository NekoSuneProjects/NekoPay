'use strict';

const crypto = require('crypto');

const DEFAULT_RPC = process.env.SOLANA_RPC_URL || process.env.NEKOPAY_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TIMEOUT_MS = Number(process.env.NEKOPAY_SOLANA_TIMEOUT_MS || 20000);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  let value = BigInt(`0x${buffer.toString('hex') || '0'}`);
  let output = '';
  while (value > 0n) {
    const digit = Number(value % 58n);
    output = BASE58_ALPHABET[digit] + output;
    value /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    output = '1' + output;
  }
  return output || '1';
}

function generateReference() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return base58Encode(der.subarray(der.length - 32));
}

function decimalToUnits(value, decimals) {
  const text = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid Solana payment amount');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(`${whole}${(fraction + '0'.repeat(decimals)).slice(0, decimals)}`);
}

class SolanaRpc {
  constructor(url = DEFAULT_RPC) {
    this.url = String(url || DEFAULT_RPC).trim();
    this.id = 0;
  }

  async call(method, params = []) {
    const response = await fetch(this.url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'NekoPay/2' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params })
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new Error(`Solana RPC returned non-JSON (HTTP ${response.status})`); }
    if (!response.ok || body?.error) throw new Error(body?.error?.message || `Solana RPC HTTP ${response.status}`);
    return body?.result;
  }

  signatures(address, limit = 20) {
    return this.call('getSignaturesForAddress', [address, { limit }]);
  }

  transaction(signature) {
    return this.call('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  }

  signatureStatus(signature) {
    return this.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  }
}

function confirmationsFromStatus(status) {
  if (!status) return 0;
  if (Number.isFinite(Number(status.confirmations))) return Number(status.confirmations);
  if (status.confirmationStatus === 'finalized') return 32;
  if (status.confirmationStatus === 'confirmed') return 1;
  return 0;
}

function nativeTransferMatches(transaction, recipient, expectedLamports) {
  const instructions = transaction?.transaction?.message?.instructions || [];
  return instructions.some((instruction) => {
    const parsed = instruction?.parsed;
    if (!parsed || parsed.type !== 'transfer') return false;
    const info = parsed.info || {};
    return String(info.destination || '') === recipient && BigInt(String(info.lamports || 0)) === expectedLamports;
  });
}

function tokenTransferMatches(transaction, recipient, mint, expectedUnits) {
  const pre = transaction?.meta?.preTokenBalances || [];
  const post = transaction?.meta?.postTokenBalances || [];
  const key = (row) => `${row.accountIndex}:${row.mint}:${row.owner || ''}`;
  const preMap = new Map(pre.map((row) => [key(row), BigInt(String(row.uiTokenAmount?.amount || 0))]));
  for (const row of post) {
    if (row.mint !== mint || row.owner !== recipient) continue;
    const after = BigInt(String(row.uiTokenAmount?.amount || 0));
    const before = preMap.get(key(row)) || 0n;
    if (after - before === expectedUnits) return true;
  }
  return false;
}

class SOLANAPAYModule {
  constructor(overrides = {}) {
    this.url = overrides.url || DEFAULT_RPC;
    this.tokenContract = overrides.tokenContract || null;
    this.decimals = Number(overrides.decimals ?? (this.tokenContract ? 6 : 9));
    this.rpc = new SolanaRpc(this.url);
  }

  async createPayment({ recipient, amount, splToken, reference, label, message, memo }) {
    if (!recipient) throw new Error('Solana recipient is required');
    const ref = reference || generateReference();
    const params = new URLSearchParams();
    params.set('amount', String(amount));
    const token = splToken || this.tokenContract;
    if (token) params.set('spl-token', token);
    params.append('reference', ref);
    if (label) params.set('label', String(label));
    if (message) params.set('message', String(message));
    if (memo) params.set('memo', String(memo));
    return { url: `solana:${recipient}?${params.toString()}`, reference: ref };
  }

  async existsTransaction(recipient, amount, timestamp, reference, minimumConfirmations = 0) {
    if (!reference) return { exists: false, txid: '', conf: 0 };
    const since = Number(timestamp || 0) > 1e12 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp || 0);
    const signatures = await this.rpc.signatures(reference, 20);
    for (const row of signatures || []) {
      if (row.err) continue;
      if (since && Number(row.blockTime || 0) && Number(row.blockTime) < since) continue;
      const transaction = await this.rpc.transaction(row.signature);
      if (!transaction || transaction.meta?.err) continue;
      const matches = this.tokenContract
        ? tokenTransferMatches(transaction, recipient, this.tokenContract, decimalToUnits(amount, this.decimals))
        : nativeTransferMatches(transaction, recipient, decimalToUnits(amount, 9));
      if (!matches) continue;
      const statusResult = await this.rpc.signatureStatus(row.signature);
      const status = statusResult?.value?.[0] || null;
      const conf = confirmationsFromStatus(status);
      return { exists: conf >= Number(minimumConfirmations || 0), txid: row.signature, conf, raw: transaction };
    }
    return { exists: false, txid: '', conf: 0 };
  }
}

module.exports = {
  SOLANAPAYModule,
  SolanaRpc,
  generateReference,
  base58Encode
};
