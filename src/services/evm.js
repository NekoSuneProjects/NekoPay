const axios = require('axios');

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

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

async function fetchJson(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    }
  });
  return data;
}

async function fetchWithFallback(baseUrl, altUrls, path) {
  const urls = [baseUrl, ...(Array.isArray(altUrls) ? altUrls : [])].filter(Boolean);
  let lastError = null;

  for (const root of urls) {
    try {
      return await fetchJson(`${String(root).replace(/\/+$/, '')}${path}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to reach EVM explorer');
}

function getExplorerConfig(tokenConfig = {}) {
  return {
    url: tokenConfig.url,
    altExplorerUrls: tokenConfig.altExplorerUrls || []
  };
}

function getExpectedUnits(amount, tokenConfig = {}) {
  return decimalToUnits(amount, Number(tokenConfig.decimals || 18));
}

function matchesNativeTransfer(transaction, expectedAddress, expectedUnits, minTimestamp) {
  if (!transaction || Number(transaction.blockTime || 0) < minTimestamp) {
    return null;
  }

  const outputs = Array.isArray(transaction.vout) ? transaction.vout : [];
  const total = outputs.reduce((sum, output) => {
    const addresses = Array.isArray(output.addresses) ? output.addresses.map(normalizeAddress) : [];
    if (!addresses.includes(expectedAddress)) {
      return sum;
    }
    return sum + BigInt(String(output.value || '0'));
  }, 0n);

  if (total !== expectedUnits) {
    return null;
  }

  return {
    txid: transaction.txid || null,
    conf: Number(transaction.confirmations || 0)
  };
}

function matchesTokenTransfer(transaction, expectedAddress, expectedUnits, tokenConfig, minTimestamp) {
  if (!transaction || Number(transaction.blockTime || 0) < minTimestamp) {
    return null;
  }

  const expectedContract = normalizeAddress(tokenConfig.contract);
  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];

  for (const transfer of transfers) {
    if (normalizeAddress(transfer.contract) !== expectedContract) continue;
    if (normalizeAddress(transfer.to) !== expectedAddress) continue;
    if (BigInt(String(transfer.value || '0')) !== expectedUnits) continue;

    return {
      txid: transaction.txid || null,
      conf: Number(transaction.confirmations || 0)
    };
  }

  return null;
}

async function getAddressPage(address, page, tokenConfig = {}) {
  const { url, altExplorerUrls } = getExplorerConfig(tokenConfig);
  return fetchWithFallback(
    url,
    altExplorerUrls,
    `/v2/address/${address}?details=txs&page=${page}&pageSize=50`
  );
}

async function findEvmTransaction(address, amount, createdAt, tokenConfig = {}) {
  const expectedAddress = normalizeAddress(address);
  const expectedUnits = getExpectedUnits(amount, tokenConfig);
  const minTimestamp = Math.floor(new Date(createdAt).getTime() / 1000);

  for (let page = 1; page <= 5; page += 1) {
    const payload = await getAddressPage(address, page, tokenConfig);
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    if (!transactions.length) break;

    for (const transaction of transactions) {
      const match = tokenConfig.contract
        ? matchesTokenTransfer(transaction, expectedAddress, expectedUnits, tokenConfig, minTimestamp)
        : matchesNativeTransfer(transaction, expectedAddress, expectedUnits, minTimestamp);

      if (match) {
        return match;
      }
    }

    const oldestTimestamp = Math.min(
      ...transactions
        .map((transaction) => Number(transaction.blockTime || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
    );

    if (!Number.isFinite(oldestTimestamp) || oldestTimestamp < minTimestamp) {
      break;
    }
  }

  return null;
}

async function existsEvmTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 0) {
  const match = await findEvmTransaction(address, amount, createdAt, tokenConfig);
  if (!match) {
    return {
      exists: false,
      txid: null,
      conf: 0
    };
  }

  return {
    exists: Number(match.conf || 0) >= Number(minimumConfirmations || 0),
    txid: match.txid || null,
    conf: Number(match.conf || 0)
  };
}

module.exports = {
  existsEvmTransaction
};
