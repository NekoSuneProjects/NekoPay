// Data-driven catalog of HOSTED payment gateways surfaced in the NekoPay dashboard.
//
// The endpoint/auth/profile data is VENDORED here (sourced from the nekosunevr-payments
// package's lib/config/chains.js, v1.2.0). We deliberately do NOT deep-require the package
// at runtime: the published/betatesting build that gets installed lags the local dev copy
// (e.g. v1.1.3 ships a monolithic build with no lib/config/chains.js), so coupling the
// dashboard catalog to the package version is fragile. Vendoring keeps the dashboard
// independent of package version skew.
//
// We also never instantiate the package's PaymentAPI in a request: its constructor reads
// every credential from process.env (unsafe for per-store keys under concurrency). The
// create/check flow in ./hosted-gateways.js replicates the package's tiny auth/profile
// logic with per-store keys instead.
//
// Surfacing is an explicit allow-list: only gateways defined below appear in the dashboard.
// stripe/paypal/nowpayments/zbd are intentionally excluded — they remain first-class flat
// fields elsewhere. Crypto token keys (eth/pol/bnb/...) are never represented here.
//
// tier 'full'  = tested/confirmed create+check flow.
// tier 'beta'  = endpoints approximated (verified:false upstream) — surfaced with a BETA
//                badge + at-your-own-risk note; create is best-effort.
// flow         = customer-facing presentation: 'redirect' (hosted page), 'lightning',
//                'crypto-invoice' (address+amount).
// adapter      = which implementation in ./hosted-gateways.js handles create/check.

const GATEWAY_DEFS = [
  // ---------------- Full tier (functional) ----------------
  {
    key: 'coinbase', label: 'Coinbase Commerce', category: 'gateway-crypto',
    tier: 'full', flow: 'redirect', adapter: 'coinbase', verified: true,
    baseUrl: 'https://api.commerce.coinbase.com/', auth: { env: 'COINBASE_API_KEY' }
  },
  {
    key: 'opennode', label: 'OpenNode (Lightning)', category: 'gateway-lightning',
    tier: 'full', flow: 'lightning', adapter: 'opennode', verified: true,
    baseUrl: 'https://api.opennode.com/', auth: { env: 'OPENNODE_API_KEY' }
  },
  {
    key: 'mollie', label: 'Mollie', category: 'gateway-fiat',
    tier: 'full', flow: 'redirect', adapter: 'generic-rest', verified: true,
    baseUrl: 'https://api.mollie.com/v2/',
    gatewayProfile: { createEndpoint: 'payments', getEndpoint: (id) => `payments/${id}` },
    auth: { scheme: 'Bearer ', env: 'MOLLIE_API_KEY' }
  },
  {
    key: 'coingate', label: 'CoinGate', category: 'gateway-crypto',
    tier: 'full', flow: 'redirect', adapter: 'generic-rest', verified: true,
    baseUrl: 'https://api.coingate.com/v2/',
    gatewayProfile: { createEndpoint: 'orders', getEndpoint: (id) => `orders/${id}` },
    auth: { scheme: 'Bearer ', env: 'COINGATE_API_TOKEN' }
  },
  {
    key: 'paystack', label: 'Paystack', category: 'gateway-fiat',
    tier: 'full', flow: 'redirect', adapter: 'generic-rest', verified: true,
    baseUrl: 'https://api.paystack.co/',
    gatewayProfile: { createEndpoint: 'transaction/initialize', getEndpoint: (id) => `transaction/verify/${id}` },
    auth: { scheme: 'Bearer ', env: 'PAYSTACK_SECRET_KEY' }
  },
  {
    key: 'razorpay', label: 'Razorpay', category: 'gateway-fiat',
    tier: 'full', flow: 'redirect', adapter: 'generic-rest', verified: true,
    baseUrl: 'https://api.razorpay.com/v1/',
    gatewayProfile: { createEndpoint: 'payment_links', getEndpoint: (id) => `payment_links/${id}` },
    auth: { basic: true, env: 'RAZORPAY_KEY_ID', env2: 'RAZORPAY_KEY_SECRET' }
  },

  // ---------------- Beta tier — PSP aggregators ----------------
  {
    key: 'flutterwave', label: 'Flutterwave', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.flutterwave.com/v3/',
    gatewayProfile: { createEndpoint: 'payments', getEndpoint: (id) => `transactions/${id}/verify` },
    auth: { scheme: 'Bearer ', env: 'FLUTTERWAVE_SECRET_KEY' }
  },
  {
    key: 'mercadopago', label: 'Mercado Pago', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.mercadopago.com/',
    gatewayProfile: { createEndpoint: 'checkout/preferences', getEndpoint: (id) => `v1/payments/${id}` },
    auth: { scheme: 'Bearer ', env: 'MERCADOPAGO_ACCESS_TOKEN' }
  },
  {
    key: 'checkoutcom', label: 'Checkout.com', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.checkout.com/',
    gatewayProfile: { createEndpoint: 'payments', getEndpoint: (id) => `payments/${id}` },
    auth: { scheme: 'Bearer ', env: 'CHECKOUT_SECRET_KEY' }
  },
  {
    key: 'adyen', label: 'Adyen', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://checkout-test.adyen.com/v71/',
    gatewayProfile: { createEndpoint: 'payments', getEndpoint: (id) => `payments/${id}` },
    auth: { name: 'X-API-Key', scheme: '', env: 'ADYEN_API_KEY' }
  },
  {
    key: 'klarna', label: 'Klarna', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.klarna.com/',
    gatewayProfile: { createEndpoint: 'payments/v1/sessions', getEndpoint: (id) => `payments/v1/sessions/${id}` },
    auth: { basic: true, env: 'KLARNA_USERNAME', env2: 'KLARNA_PASSWORD' }
  },
  {
    key: 'revolut', label: 'Revolut Pay', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://merchant.revolut.com/api/',
    gatewayProfile: { createEndpoint: 'orders', getEndpoint: (id) => `orders/${id}` },
    auth: { scheme: 'Bearer ', env: 'REVOLUT_SECRET_KEY' }
  },
  {
    key: 'pagseguro', label: 'PagSeguro', category: 'gateway-fiat',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.pagseguro.com/',
    gatewayProfile: { createEndpoint: 'orders', getEndpoint: (id) => `orders/${id}` },
    auth: { scheme: 'Bearer ', env: 'PAGSEGURO_TOKEN' }
  },

  // ---------------- Beta tier — crypto processors ----------------
  {
    key: 'bitpay', label: 'BitPay', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://bitpay.com/',
    gatewayProfile: { createEndpoint: 'v2/invoices', getEndpoint: (id) => `v2/invoices/${id}` },
    auth: { scheme: 'Bearer ', env: 'BITPAY_API_KEY' }
  },
  {
    key: 'cryptomus', label: 'Cryptomus', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.cryptomus.com/v1/',
    gatewayProfile: { createEndpoint: 'payment', getEndpoint: () => 'payment/info' },
    auth: { scheme: 'Bearer ', env: 'CRYPTOMUS_API_KEY' }
  },
  {
    key: 'oxapay', label: 'OxaPay', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.oxapay.com/',
    gatewayProfile: { createEndpoint: 'merchants/request', getEndpoint: () => 'merchants/inquiry' },
    auth: { scheme: 'Bearer ', env: 'OXAPAY_MERCHANT_KEY' }
  },
  {
    key: 'plisio', label: 'Plisio', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.plisio.net/api/v1/',
    gatewayProfile: { createEndpoint: 'invoices/new', getEndpoint: (id) => `operations/${id}` },
    auth: { scheme: 'Bearer ', env: 'PLISIO_API_KEY' }
  },
  {
    key: 'btcpay', label: 'BTCPay Server', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false, selfHosted: true,
    baseUrl: 'https://your-btcpay-instance.example/',
    gatewayProfile: { createEndpoint: 'api/v1/invoices', getEndpoint: (id) => `api/v1/invoices/${id}` },
    auth: { scheme: 'token ', env: 'BTCPAY_API_KEY' }
  },
  {
    key: 'confirmo', label: 'Confirmo', category: 'gateway-crypto',
    tier: 'beta', flow: 'crypto-invoice', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.confirmo.net/',
    gatewayProfile: { createEndpoint: 'api/v3/invoices', getEndpoint: (id) => `api/v3/invoices/${id}` },
    auth: { scheme: 'Bearer ', env: 'CONFIRMO_API_KEY' }
  },

  // ---------------- Beta tier — Lightning ----------------
  {
    key: 'strike', label: 'Strike', category: 'gateway-lightning',
    tier: 'beta', flow: 'lightning', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.strike.me/v1/',
    gatewayProfile: { createEndpoint: 'invoices', getEndpoint: (id) => `invoices/${id}` },
    auth: { scheme: 'Bearer ', env: 'STRIKE_API_KEY' }
  },
  {
    key: 'alby', label: 'Alby', category: 'gateway-lightning',
    tier: 'beta', flow: 'lightning', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.getalby.com/',
    gatewayProfile: { createEndpoint: 'invoices', getEndpoint: (id) => `invoices/${id}` },
    auth: { scheme: 'Bearer ', env: 'ALBY_ACCESS_TOKEN' }
  },
  {
    key: 'speed', label: 'Speed', category: 'gateway-lightning',
    tier: 'beta', flow: 'lightning', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.tryspeed.com/',
    gatewayProfile: { createEndpoint: 'payments', getEndpoint: (id) => `payments/${id}` },
    auth: { basic: true, env: 'SPEED_SECRET_KEY' } // basic with empty password
  },

  // ---------------- Beta tier — Gaming / commerce ----------------
  {
    key: 'paynow', label: 'PayNow.gg', category: 'gateway-gaming',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://api.paynow.gg/v1/',
    gatewayProfile: { createEndpoint: 'checkouts', getEndpoint: (id) => `orders/${id}` },
    auth: { scheme: 'apikey ', env: 'PAYNOW_API_KEY' }
  },
  {
    key: 'antistock', label: 'Antistock', category: 'gateway-gaming',
    tier: 'beta', flow: 'redirect', adapter: 'generic-rest', verified: false,
    baseUrl: 'https://dev.antistock.io/',
    gatewayProfile: { createEndpoint: 'invoices', getEndpoint: (id) => `invoices/${id}` },
    auth: { scheme: 'Bearer ', env: 'ANTISTOCK_API_KEY' }
  }
];

// Credential fields per gateway: basic-auth with two env vars → keyId + keySecret;
// everything else (bearer/token/header/single-key basic) → a single apiKey.
function fieldsForEntry(entry) {
  const { auth, label } = entry;
  if (auth && auth.basic && auth.env2) {
    return [
      { name: 'keyId', label: `${label} key ID`, secret: true },
      { name: 'keySecret', label: `${label} key secret`, secret: true }
    ];
  }
  return [{ name: 'apiKey', label: `${label} API key`, secret: true }];
}

const HOSTED_GATEWAYS = GATEWAY_DEFS.map((entry) => ({
  deprecated: false,
  selfHosted: false,
  ...entry,
  fields: fieldsForEntry(entry)
}));

const HOSTED_GATEWAY_MAP = HOSTED_GATEWAYS.reduce((map, entry) => {
  map[entry.key] = entry;
  return map;
}, {});

function getGatewayCatalogEntry(key) {
  return HOSTED_GATEWAY_MAP[String(key || '').toLowerCase()] || null;
}

function gatewayFieldKeys(key) {
  const entry = getGatewayCatalogEntry(key);
  return entry ? entry.fields.map((field) => field.name) : [];
}

function isCatalogGateway(key) {
  return Boolean(getGatewayCatalogEntry(key));
}

// Client-safe shape for the bootstrap payload: omit internal endpoint/auth wiring,
// keep only what the dashboard UI needs to render config cards and labels.
function publicCatalog() {
  return HOSTED_GATEWAYS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    category: entry.category,
    flow: entry.flow,
    tier: entry.tier,
    deprecated: entry.deprecated,
    selfHosted: entry.selfHosted,
    fields: entry.fields.map((field) => ({ name: field.name, label: field.label, secret: field.secret }))
  }));
}

module.exports = {
  HOSTED_GATEWAYS,
  HOSTED_GATEWAY_MAP,
  getGatewayCatalogEntry,
  gatewayFieldKeys,
  isCatalogGateway,
  publicCatalog
};
