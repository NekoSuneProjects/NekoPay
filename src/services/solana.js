// On-chain verification for native SOL and SPL-token (USDC/USDT) payments.
//
// Solana is NOT EVM, so it cannot ride on ./evm.js. Instead of an explorer REST API we use
// the Solana JSON-RPC directly: getSignaturesForAddress lists recent transactions touching the
// merchant wallet, getTransaction pulls each one so we can diff pre/post balances.
//
// Native SOL: compare lamport balance delta on the merchant account index.
// SPL token:  compare the token-account balance delta for {owner: wallet, mint: contract}.
//
// Confirmation model differs from EVM block confirmations: Solana settles via commitment
// levels. We treat a 'finalized' signature as fully settled; otherwise we fall back to the
// numeric `confirmations` the RPC reports against the caller's minimumConfirmations.

const axios = require('axios');

const DEFAULT_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

function decimalToUnits(value, decimals) {
  const safe = String(value ?? '0').trim();
  if (!safe) return 0n;
  const negative = safe.startsWith('-');
  const unsigned = negative ? safe.slice(1) : safe;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = `${fraction}${'0'.repeat(Math.max(0, decimals))}`.slice(0, decimals);
  const units = BigInt(`${whole || '0'}${padded || ''}`);
  return negative ? -units : units;
}

function getRpcUrls(tokenConfig = {}) {
  return [tokenConfig.url || DEFAULT_RPC_URL, ...(Array.isArray(tokenConfig.altExplorerUrls) ? tokenConfig.altExplorerUrls : [])]
    .filter(Boolean);
}

async function rpcCall(url, method, params) {
  const { data } = await axios.post(
    url,
    { jsonrpc: '2.0', id: 1, method, params },
    {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
      }
    }
  );
  if (data && data.error) {
    throw new Error(data.error.message || 'Solana RPC error');
  }
  return data ? data.result : null;
}

async function rpcWithFallback(urls, method, params) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await rpcCall(url, method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to reach Solana RPC');
}

// accountKeys come back as plain strings (legacy) or {pubkey} objects (jsonParsed).
function accountKeyStrings(transaction) {
  const keys = transaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => (typeof key === 'string' ? key : key?.pubkey)).filter(Boolean);
}

function matchesNativeTransfer(transaction, expectedAddress, expectedUnits) {
  const meta = transaction?.meta;
  if (!meta || !Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances)) {
    return false;
  }
  const index = accountKeyStrings(transaction).indexOf(expectedAddress);
  if (index === -1) return false;
  const delta = BigInt(String(meta.postBalances[index] ?? 0)) - BigInt(String(meta.preBalances[index] ?? 0));
  return delta === expectedUnits;
}

function matchesTokenTransfer(transaction, expectedAddress, expectedUnits, expectedMint) {
  const meta = transaction?.meta;
  if (!meta) return false;
  const post = (meta.postTokenBalances || []).filter(
    (balance) => balance.mint === expectedMint && balance.owner === expectedAddress
  );
  if (!post.length) return false;

  for (const entry of post) {
    const pre = (meta.preTokenBalances || []).find((balance) => balance.accountIndex === entry.accountIndex);
    const before = pre ? BigInt(String(pre.uiTokenAmount?.amount ?? 0)) : 0n;
    const after = BigInt(String(entry.uiTokenAmount?.amount ?? 0));
    if (after - before === expectedUnits) return true;
  }
  return false;
}

async function findSolanaTransaction(address, amount, createdAt, tokenConfig = {}) {
  const urls = getRpcUrls(tokenConfig);
  const decimals = Number(tokenConfig.contract ? (tokenConfig.decimals ?? 6) : (tokenConfig.decimals ?? 9));
  const expectedUnits = decimalToUnits(amount, decimals);
  const minTimestamp = Math.floor(new Date(createdAt).getTime() / 1000);

  const signatures = await rpcWithFallback(urls, 'getSignaturesForAddress', [address, { limit: 50 }]);
  if (!Array.isArray(signatures)) return null;

  for (const signature of signatures) {
    if (signature.err) continue;
    // Signatures are newest-first; once we pass below the invoice creation time we can stop.
    // blockTime can be null for very recent slots — only stop on a confirmed older timestamp.
    if (Number.isFinite(Number(signature.blockTime)) && Number(signature.blockTime) < minTimestamp) {
      break;
    }

    const transaction = await rpcWithFallback(urls, 'getTransaction', [
      signature.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
    ]);
    if (!transaction || transaction.meta?.err) continue;

    const matched = tokenConfig.contract
      ? matchesTokenTransfer(transaction, address, expectedUnits, tokenConfig.contract)
      : matchesNativeTransfer(transaction, address, expectedUnits);

    if (matched) {
      return {
        txid: signature.signature,
        finalized: signature.confirmationStatus === 'finalized',
        conf: Number(signature.confirmations || 0)
      };
    }
  }

  return null;
}

async function existsSolanaTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 0) {
  const match = await findSolanaTransaction(address, amount, createdAt, tokenConfig);
  if (!match) {
    return { exists: false, txid: null, conf: 0 };
  }

  const required = Number(minimumConfirmations || 0);
  const exists = match.finalized || match.conf >= required;
  // Report a confirmation count that reflects settlement for display/storage.
  const conf = match.finalized ? Math.max(required, 1) : match.conf;

  return { exists, txid: match.txid || null, conf };
}

module.exports = {
  existsSolanaTransaction
};
