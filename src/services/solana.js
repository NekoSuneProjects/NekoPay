// Solana payments via the nekosunevr-payments package's Solana Pay module.
//
// Rather than calling @solana/pay directly, this delegates to the package's SOLANAPAYModule
// "callout" — the same modular interface NekoPay already uses for HIVE/STEEM/etc. (see
// chainModules in ./platform.js). That keeps a single source of truth for the Solana Pay
// create/verify flow in the package, and this file is just the thin adapter that maps our
// per-store token config + the {exists,txid,conf} shape the platform dispatch expects.
//
// Flow (official Solana Pay merchant pattern):
//   createSolanaPayRequest() -> { reference, url, qr } : a `solana:` URL + QR; persist `reference`.
//   existsSolanaTransaction(..., reference) -> findReference + validateTransfer by that reference,
//   so two same-amount payments to one wallet never collide.

const { SOLANAPAYModule } = require('nekosunevr-payments');
const QRCode = require('qrcode');

const DEFAULT_RPC_URL = process.env.SOLANA_RPC_URL
  || process.env.NEKOPAY_SOLANAPAY_EXPLORER_URL
  || 'https://api.mainnet-beta.solana.com';

// Build a SOLANAPAYModule for this token. For SPL tokens we pass `isSolana: true` so the
// package preserves the base58 mint case — its constructor otherwise lowercases tokenContract
// for non-`isSolana` modules, which corrupts a Solana mint into an invalid public key.
function getModule(tokenConfig = {}) {
  const overrides = { url: tokenConfig.url || DEFAULT_RPC_URL };
  if (tokenConfig.contract) {
    overrides.tokenContract = tokenConfig.contract;
    overrides.isSolana = true;
  }
  return new SOLANAPAYModule(overrides);
}

// Build the customer-facing Solana Pay request: a `solana:` URL, a scannable QR (PNG data URI),
// and the reference we persist on the payment attempt to verify it later.
async function createSolanaPayRequest({ recipient, amount, tokenConfig = {}, label, message, memo }) {
  const mod = getModule(tokenConfig);
  const { url, reference } = await mod.createPayment({
    recipient,
    amount,
    splToken: tokenConfig.contract || undefined,
    label: label || undefined,
    message: message || undefined,
    memo: memo || undefined
  });

  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360 });
  return { reference, url, qr };
}

// Verify a Solana Pay payment by its reference. Returns { exists, txid, conf } to match the
// shape the platform dispatch (checkSupportedOnchainTransaction) expects.
async function existsSolanaTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 0, reference = null) {
  if (!reference) {
    // Every Solana Pay invoice stores a reference; without it there is nothing to look up.
    return { exists: false, txid: null, conf: 0 };
  }

  const mod = getModule(tokenConfig);
  const timestamp = createdAt ? new Date(createdAt).getTime() : 0;

  // SOLANAPAYModule.existsTransaction(address, amount, timestamp, reference, minConfirmations).
  // The reference is passed in the `memo` slot — the module routes it to findReference.
  const result = await mod.existsTransaction(address, amount, timestamp, reference, Number(minimumConfirmations || 0));

  return {
    exists: Boolean(result && result.exists),
    txid: (result && result.txid) || null,
    conf: Number((result && result.conf) || 0)
  };
}

module.exports = {
  createSolanaPayRequest,
  existsSolanaTransaction
};
