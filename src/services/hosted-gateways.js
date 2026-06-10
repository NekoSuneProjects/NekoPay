// Per-store create/check flow for catalog hosted gateways (src/config/gateways.js).
//
// We deliberately do NOT use the nekosunevr-payments PaymentAPI here: it reads every
// credential from process.env, which is unsafe for a multi-store server. Instead we
// replicate its tiny auth/profile logic with plain axios + the per-store decrypted keys
// passed in via `config.hosted[gatewayKey]`.
//
// Full-tier gateways (coinbase/opennode/mollie/coingate/paystack/razorpay) have confirmed
// request mappers + response extractors. Beta gateways use a best-effort default mapper and
// a deep-search extractor; if the provider rejects the request we surface a clear error
// rather than crashing.

const axios = require('axios');
const { getGatewayCatalogEntry } = require('../config/gateways');

// Statuses (lowercased) that mean "the customer has paid / is paying".
const COMPLETED_STATES = new Set([
  'paid', 'complete', 'completed', 'confirmed', 'succeeded', 'success', 'finished',
  'settled', 'done', 'processing', 'sending', 'partially_paid', 'resolved'
]);
const FAILED_STATES = new Set(['failed', 'expired', 'cancelled', 'canceled', 'declined', 'void', 'invalid', 'refunded']);

// Build the Authorization (or custom) header from the catalog auth descriptor + per-store
// creds. Mirrors PaymentAPI's auth logic but reads creds, not process.env.
function buildAuthHeader(entry, creds = {}) {
  const auth = entry.auth || {};
  if (auth.basic) {
    const user = creds.keyId || creds.apiKey || '';
    const pass = auth.env2 ? (creds.keySecret || '') : '';
    return { [auth.name || 'Authorization']: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
  }
  return { [auth.name || 'Authorization']: `${auth.scheme || ''}${creds.apiKey || ''}` };
}

function hasCredentials(entry, creds = {}) {
  return entry.fields.every((field) => Boolean(creds?.[field.name]));
}

function minor(amount) {
  return Math.round(Number(amount || 0) * 100);
}

// ---- Per-gateway request body mappers (full tier confirmed; beta best-effort) ----
const REQUEST_MAPPERS = {
  mollie: (ctx) => ({
    amount: { currency: ctx.currency, value: Number(ctx.amount).toFixed(2) },
    description: ctx.description,
    redirectUrl: ctx.successUrl,
    webhookUrl: ctx.callbackUrl,
    metadata: { reference: ctx.reference }
  }),
  coingate: (ctx) => ({
    order_id: ctx.reference,
    price_amount: Number(ctx.amount),
    price_currency: ctx.currency,
    receive_currency: ctx.currency,
    title: ctx.description,
    success_url: ctx.successUrl,
    cancel_url: ctx.cancelUrl,
    callback_url: ctx.callbackUrl
  }),
  paystack: (ctx) => ({
    email: ctx.customer?.email || 'customer@example.com',
    amount: minor(ctx.amount),
    currency: ctx.currency,
    reference: String(ctx.reference).replace(/[^a-zA-Z0-9._-]/g, ''),
    callback_url: ctx.successUrl
  }),
  razorpay: (ctx) => ({
    amount: minor(ctx.amount),
    currency: ctx.currency,
    description: ctx.description,
    reference_id: String(ctx.reference),
    callback_url: ctx.successUrl,
    callback_method: 'get'
  }),
  flutterwave: (ctx) => ({
    tx_ref: String(ctx.reference),
    amount: Number(ctx.amount),
    currency: ctx.currency,
    redirect_url: ctx.successUrl,
    customer: { email: ctx.customer?.email || 'customer@example.com' }
  }),
  mercadopago: (ctx) => ({
    items: [{ title: ctx.description, quantity: 1, unit_price: Number(ctx.amount), currency_id: ctx.currency }],
    back_urls: { success: ctx.successUrl, failure: ctx.cancelUrl, pending: ctx.successUrl },
    external_reference: String(ctx.reference),
    notification_url: ctx.callbackUrl
  }),
  bitpay: (ctx) => ({
    price: Number(ctx.amount),
    currency: ctx.currency,
    orderId: String(ctx.reference),
    redirectURL: ctx.successUrl,
    notificationURL: ctx.callbackUrl
  }),
  cryptomus: (ctx) => ({
    amount: String(ctx.amount),
    currency: ctx.currency,
    order_id: String(ctx.reference),
    url_callback: ctx.callbackUrl,
    url_return: ctx.successUrl
  }),
  oxapay: (ctx) => ({
    amount: Number(ctx.amount),
    currency: ctx.currency,
    orderId: String(ctx.reference),
    callbackUrl: ctx.callbackUrl,
    returnUrl: ctx.successUrl
  }),
  plisio: (ctx) => ({
    order_number: String(ctx.reference),
    amount: Number(ctx.amount),
    currency: ctx.currency,
    callback_url: ctx.callbackUrl
  }),
  confirmo: (ctx) => ({
    amount: String(ctx.amount),
    currency: ctx.currency,
    reference: String(ctx.reference),
    notifyUrl: ctx.callbackUrl,
    returnUrl: ctx.successUrl
  }),
  btcpay: (ctx) => ({
    amount: Number(ctx.amount),
    currency: ctx.currency,
    metadata: { orderId: String(ctx.reference) }
  }),
  strike: (ctx) => ({
    correlationId: String(ctx.reference).slice(0, 40),
    description: ctx.description,
    amount: { currency: ctx.currency, amount: Number(ctx.amount).toFixed(2) }
  }),
  alby: (ctx) => ({
    amount: minor(ctx.amount),
    currency: ctx.currency,
    description: ctx.description
  }),
  speed: (ctx) => ({
    amount: Number(ctx.amount),
    currency: ctx.currency,
    payment_methods: ['lightning'],
    description: ctx.description
  }),
  paynow: (ctx) => ({
    reference: String(ctx.reference),
    currency: ctx.currency,
    return_url: ctx.successUrl,
    cancel_url: ctx.cancelUrl,
    lines: [{ name: ctx.description, quantity: 1, price: minor(ctx.amount) }]
  }),
  antistock: (ctx) => ({
    amount: Number(ctx.amount),
    currency: ctx.currency,
    reference: String(ctx.reference),
    return_url: ctx.successUrl
  })
};

// Best-effort default body for any beta gateway without an explicit mapper.
function defaultRequestBody(ctx) {
  return {
    amount: Number(ctx.amount),
    currency: ctx.currency,
    order_id: String(ctx.reference),
    description: ctx.description,
    success_url: ctx.successUrl,
    cancel_url: ctx.cancelUrl,
    callback_url: ctx.callbackUrl
  };
}

// ---- Response extractors: pull a redirect URL + provider reference out of the response ----
const REDIRECT_KEYS = [
  'hosted_url', 'hosted_checkout_url', 'invoice_url', 'checkout_url', 'payment_url',
  'authorization_url', 'short_url', 'url', 'redirect_url', 'redirectUrl', 'init_point',
  'sandbox_init_point', 'paymentUrl', 'link'
];
const REFERENCE_KEYS = ['id', 'uuid', 'code', 'reference', 'token', 'order_id', 'orderId', 'payment_id', 'paymentId', 'transaction_id'];

// Depth-limited search for the first string value under any of `keys`.
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFind(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const RESPONSE_EXTRACTORS = {
  coinbase: (data) => ({ redirectUrl: data?.data?.hosted_url || null, providerReference: data?.data?.code || data?.data?.id || null, instructions: null }),
  opennode: (data) => ({
    redirectUrl: data?.data?.hosted_checkout_url || null,
    providerReference: data?.data?.id || null,
    instructions: data?.data?.lightning_invoice?.payreq
      ? { invoiceRequest: data.data.lightning_invoice.payreq, amount: String(data?.data?.amount ?? ''), currency: 'SAT', address: data?.data?.address || null }
      : null
  }),
  mollie: (data) => ({ redirectUrl: data?._links?.checkout?.href || null, providerReference: data?.id || null, instructions: null }),
  coingate: (data) => ({ redirectUrl: data?.payment_url || null, providerReference: data?.id ? String(data.id) : null, instructions: null }),
  paystack: (data) => ({ redirectUrl: data?.data?.authorization_url || null, providerReference: data?.data?.reference || null, instructions: null }),
  razorpay: (data) => ({ redirectUrl: data?.short_url || null, providerReference: data?.id || null, instructions: null }),
  mercadopago: (data) => ({ redirectUrl: data?.init_point || data?.sandbox_init_point || null, providerReference: data?.id ? String(data.id) : null, instructions: null })
};

function extractResponse(entry, data) {
  if (RESPONSE_EXTRACTORS[entry.key]) return RESPONSE_EXTRACTORS[entry.key](data);
  return {
    redirectUrl: deepFind(data, REDIRECT_KEYS),
    providerReference: deepFind(data, REFERENCE_KEYS),
    instructions: null
  };
}

// ---- Create ----
async function createHostedGatewayPayment(ctx) {
  const { normalized, config } = ctx;
  const entry = getGatewayCatalogEntry(normalized);
  if (!entry) throw new Error(`Unknown hosted gateway: ${normalized}`);
  const creds = (config.hosted && config.hosted[entry.key]) || {};
  if (!hasCredentials(entry, creds)) {
    throw new Error(`${entry.label} is not configured`);
  }

  let data;
  if (entry.adapter === 'coinbase') {
    const body = {
      name: ctx.description,
      description: ctx.description,
      pricing_type: 'fixed_price',
      local_price: { amount: Number(ctx.amount).toFixed(2), currency: ctx.currency },
      redirect_url: ctx.successUrl,
      cancel_url: ctx.cancelUrl,
      metadata: { reference: ctx.reference, storeId: ctx.storeId }
    };
    ({ data } = await axios.post(`${entry.baseUrl}charges`, body, {
      headers: { 'Content-Type': 'application/json', 'X-CC-Api-Key': creds.apiKey, 'X-CC-Version': '2018-03-22' }
    }));
  } else if (entry.adapter === 'opennode') {
    const body = {
      amount: Number(ctx.amount),
      currency: ctx.currency,
      order_id: String(ctx.reference),
      description: ctx.description,
      callback_url: ctx.callbackUrl,
      success_url: ctx.successUrl
    };
    ({ data } = await axios.post(`${entry.baseUrl}v1/charges`, body, {
      headers: { 'Content-Type': 'application/json', Authorization: creds.apiKey }
    }));
  } else {
    // generic-rest
    const profile = entry.gatewayProfile;
    if (!profile || !profile.createEndpoint) {
      throw new Error(`${entry.label} has no create endpoint configured`);
    }
    const body = (REQUEST_MAPPERS[entry.key] || defaultRequestBody)(ctx);
    ({ data } = await axios.post(`${entry.baseUrl}${profile.createEndpoint}`, body, {
      headers: { 'Content-Type': 'application/json', ...buildAuthHeader(entry, creds) }
    }));
  }

  const extracted = extractResponse(entry, data);
  return {
    provider: entry.key,
    providerReference: extracted.providerReference || String(ctx.reference),
    status: 'pending',
    redirectUrl: extracted.redirectUrl || null,
    instructions: extracted.instructions || null,
    providerPayload: data,
    requiresRedirect: entry.flow === 'redirect'
  };
}

// ---- Status check ----
// Returns { completed:bool, failed:bool, status:string, raw } — caller decides how to apply.
async function checkHostedGatewayStatus(store, attempt, config) {
  const entry = getGatewayCatalogEntry(attempt.methodId);
  if (!entry) return { completed: false, failed: false, status: 'unknown', raw: null };
  const creds = (config.hosted && config.hosted[entry.key]) || {};
  if (!hasCredentials(entry, creds)) {
    return { completed: false, failed: false, status: 'unconfigured', raw: null };
  }
  const profile = entry.gatewayProfile;
  let getPath;
  if (entry.adapter === 'coinbase') getPath = `charges/${attempt.providerReference}`;
  else if (entry.adapter === 'opennode') getPath = `v1/charge/${attempt.providerReference}`;
  else if (profile && profile.getEndpoint) getPath = profile.getEndpoint(attempt.providerReference);
  else return { completed: false, failed: false, status: 'unsupported', raw: null };

  const headers = entry.adapter === 'coinbase'
    ? { 'X-CC-Api-Key': creds.apiKey, 'X-CC-Version': '2018-03-22' }
    : entry.adapter === 'opennode'
      ? { Authorization: creds.apiKey }
      : buildAuthHeader(entry, creds);

  const { data } = await axios.get(`${entry.baseUrl}${getPath}`, { headers });
  // Coinbase: timeline[].status; everything else: a status/state string somewhere.
  const status = String(
    data?.data?.timeline?.slice(-1)?.[0]?.status
    || deepFind(data, ['status', 'state', 'payment_status', 'order_status'])
    || ''
  ).toLowerCase();

  return {
    completed: COMPLETED_STATES.has(status),
    failed: FAILED_STATES.has(status),
    status: status || 'pending',
    raw: data
  };
}

module.exports = {
  buildAuthHeader,
  createHostedGatewayPayment,
  checkHostedGatewayStatus,
  COMPLETED_STATES,
  FAILED_STATES
};
