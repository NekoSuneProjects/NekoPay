const axios = require('axios');

const ZBD_GAMERTAG_CHARGE_URL = 'https://api.zbdpay.com/v0/gamertag/charges';
const ZBD_LIGHTNING_CHARGE_URL = 'https://api.zbdpay.com/v0/ln-address/fetch-charge';

function getBitcoinPriceRow(rows) {
  return (rows || []).find((item) => String(item.id || '').toLowerCase() === 'bitcoin')
    || (rows || []).find((item) => String(item.symbol || '').toLowerCase() === 'btc')
    || null;
}

async function quoteSatsFromFiat(amount, currency = 'USD') {
  const { data } = await axios.get(
    `https://api.nekosunevr.co.uk/v5/cryptoapi/nekogeko/prices/${encodeURIComponent(String(currency || 'USD').toUpperCase())}`,
    {
      timeout: 15000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 NekoPay'
      }
    }
  );

  const bitcoin = getBitcoinPriceRow(data);
  if (!bitcoin?.current_price) {
    throw new Error('Bitcoin price not found');
  }

  const sats = Math.floor((Number(amount) / Number(bitcoin.current_price)) * 100000000);
  const msats = sats * 1000;

  return {
    sats,
    msats,
    unitPrice: Number(bitcoin.current_price)
  };
}

function buildInvoicePayload(data = {}) {
  return {
    invoiceRequest: data.invoiceRequest
      || data.paymentRequest
      || data.request
      || data.invoice?.request
      || data.invoice?.bolt11
      || null,
    invoiceExpiresAt: data.invoiceExpiresAt
      || data.expiresAt
      || data.invoice?.expiresAt
      || null
  };
}

async function createZbdCharge({
  apiKey,
  receiverType,
  gamertag,
  lightningAddress,
  amountMsats,
  description,
  internalId,
  callbackUrl,
  expiresIn = 1200
}) {
  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json'
  };

  if (receiverType === 'lightningaddress') {
    const { data } = await axios.post(
      ZBD_LIGHTNING_CHARGE_URL,
      {
        lnaddress: lightningAddress,
        lnAddress: lightningAddress,
        amount: String(amountMsats),
        description,
        comment: description
      },
      {
        headers,
        timeout: 15000
      }
    );

    return {
      providerReference: data?.data?.id || data?.data?.invoiceId || internalId,
      status: String(data?.data?.status || data?.status || 'pending').toLowerCase(),
      providerPayload: data,
      ...buildInvoicePayload(data?.data || data || {})
    };
  }

  const { data } = await axios.post(
    ZBD_GAMERTAG_CHARGE_URL,
    {
      amount: String(amountMsats),
      gamertag,
      description,
      expiresIn,
      internalId,
      callbackUrl
    },
    {
      headers,
      timeout: 15000
    }
  );

  return {
    providerReference: data?.data?.id || internalId,
    status: String(data?.data?.status || data?.status || 'pending').toLowerCase(),
    providerPayload: data,
    ...buildInvoicePayload(data?.data || data || {})
  };
}

module.exports = {
  quoteSatsFromFiat,
  createZbdCharge
};
