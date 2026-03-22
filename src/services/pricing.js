const axios = require('axios');
const { supportedCurrencies, supportedTokens } = require('../config/platform');

const priceCache = new Map();
const fxCache = new Map();
const PRICE_TTL = 60 * 1000;
const FX_TTL = 60 * 60 * 1000;

async function getTokenPrices(baseCurrency = 'USD') {
  const normalized = String(baseCurrency || 'USD').toUpperCase();
  const cacheKey = `price:${normalized}`;
  const cached = priceCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = `https://api.nekosunevr.co.uk/v5/cryptoapi/nekogeko/prices/${encodeURIComponent(normalized)}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  const map = new Map();

  for (const item of data || []) {
    map.set(String(item.id || '').toLowerCase(), item);
    map.set(String(item.symbol || '').toLowerCase(), item);
  }

  priceCache.set(cacheKey, {
    value: map,
    expiresAt: Date.now() + PRICE_TTL
  });

  return map;
}

async function getFxRates(baseCurrency = 'USD') {
  const normalized = String(baseCurrency || 'USD').toUpperCase();
  const cacheKey = `fx:${normalized}`;
  const cached = fxCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${encodeURIComponent(normalized)}`, {
      timeout: 15000
    });

    const rates = data?.rates || { [normalized]: 1 };
    fxCache.set(cacheKey, {
      value: rates,
      expiresAt: Date.now() + FX_TTL
    });
    return rates;
  } catch {
    return { [normalized]: 1 };
  }
}

async function convertAmount(amount, fromCurrency, toCurrency) {
  const from = String(fromCurrency || 'USD').toUpperCase();
  const to = String(toCurrency || from).toUpperCase();
  if (from === to) return Number(amount);

  const rates = await getFxRates(from);
  const rate = Number(rates[to]);
  if (!rate) return Number(amount);
  return Number((Number(amount) * rate).toFixed(2));
}

async function quoteTokenAmount(tokenId, amount, storeCurrency) {
  const token = supportedTokens[tokenId];
  if (!token || token.enabled === false) {
    throw new Error('Unsupported token');
  }

  const prices = await getTokenPrices(storeCurrency);
  const price = prices.get(String(token.priceId || token.symbol).toLowerCase()) || prices.get(token.symbol);

  if (!price || !price.current_price) {
    throw new Error(`No price found for ${token.priceId || token.symbol}`);
  }

  const decimals = Number.isInteger(token.decimals) ? token.decimals : 8;
  const tokenAmount = Number(amount) / Number(price.current_price);

  return {
    tokenId,
    symbol: String(token.invoiceSymbol || token.symbol).toUpperCase(),
    unitPrice: Number(price.current_price),
    amount: tokenAmount.toFixed(decimals)
  };
}

module.exports = {
  supportedCurrencies,
  getTokenPrices,
  getFxRates,
  convertAmount,
  quoteTokenAmount
};
