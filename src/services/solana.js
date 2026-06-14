// Solana payments via the official Solana Pay protocol (@solana/pay).
//
// Each invoice gets a unique `reference` public key (a throwaway keypair pubkey used only as an
// on-chain marker). We encode a `solana:` payment URL carrying recipient + amount + reference
// (+ SPL mint for token payments) and render it as a QR for any Solana wallet to pay.
//
// Verification is unambiguous: findReference() locates the exact signature that paid THIS
// invoice (no amount-collision guessing), then validateTransfer() confirms the recipient,
// amount, and SPL token all match what we requested. This replaces the earlier balance-scan
// heuristic, which could mis-attribute two equal-amount payments to the same wallet.

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { encodeURL, findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const BigNumber = require('bignumber.js');
const QRCode = require('qrcode');

const DEFAULT_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// 'confirmed' matches the official Solana Pay merchant example: fast detection, negligible
// reorg risk for this flow. Override to 'finalized' for maximum settlement safety.
const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';

function getConnection(tokenConfig = {}) {
  return new Connection(tokenConfig.url || DEFAULT_RPC_URL, COMMITMENT);
}

// Build the customer-facing Solana Pay request: a `solana:` URL, a scannable QR (PNG data URI),
// and the reference we must persist on the payment attempt to verify it later.
async function createSolanaPayRequest({ recipient, amount, tokenConfig = {}, label, message, memo }) {
  const reference = Keypair.generate().publicKey;
  const fields = {
    recipient: new PublicKey(recipient),
    amount: new BigNumber(amount),
    reference,
    label: label || undefined,
    message: message || undefined,
    memo: memo || undefined
  };
  if (tokenConfig.contract) {
    fields.splToken = new PublicKey(tokenConfig.contract);
  }

  const url = encodeURL(fields).toString();
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360 });

  return { reference: reference.toBase58(), url, qr };
}

// Verify a Solana Pay payment by its reference, then validate the on-chain transfer.
// Returns { exists, txid, conf } to match the shape the platform dispatch expects.
async function existsSolanaTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 0, reference = null) {
  if (!reference) {
    // Without a stored reference there is nothing to look up (every Solana Pay invoice has one).
    return { exists: false, txid: null, conf: 0 };
  }

  const connection = getConnection(tokenConfig);
  const referenceKey = new PublicKey(reference);

  let signatureInfo;
  try {
    signatureInfo = await findReference(connection, referenceKey, { finality: COMMITMENT });
  } catch (error) {
    if (error instanceof FindReferenceError) {
      // No transaction carrying this reference has landed yet — customer hasn't paid.
      return { exists: false, txid: null, conf: 0 };
    }
    throw error;
  }

  try {
    await validateTransfer(
      connection,
      signatureInfo.signature,
      {
        recipient: new PublicKey(address),
        amount: new BigNumber(amount),
        splToken: tokenConfig.contract ? new PublicKey(tokenConfig.contract) : undefined,
        reference: referenceKey
      },
      { commitment: COMMITMENT }
    );
  } catch (error) {
    // A referenced transaction exists but does not match the requested transfer (wrong amount,
    // recipient, or token) — not a valid payment for this invoice.
    return { exists: false, txid: signatureInfo.signature, conf: 0 };
  }

  return {
    exists: true,
    txid: signatureInfo.signature,
    conf: Math.max(Number(minimumConfirmations || 0), 1)
  };
}

module.exports = {
  createSolanaPayRequest,
  existsSolanaTransaction
};
