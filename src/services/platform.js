const axios = require('axios');
const Stripe = require('stripe');
const {
  HIVEModule,
  HBDModule,
  STEEMModule,
  SBDModule,
  BLURTModule,
  TLOSModule,
  EOSModule,
  FIOModule,
  WAXModule,
  PIVXModule,
  FLSModule
} = require('nekosunevr-payments');
const { append, getBy, list, updateBy } = require('../lib/app-store');
const { encryptSecret, decryptSecret, randomDigits, randomId, sha256, generateApiKey } = require('../lib/security');
const { defaultProducts, defaultTaxRate, appBaseUrl, supportedTokens } = require('../config/platform');
const { convertAmount, quoteTokenAmount } = require('./pricing');
const { sendMerchantWebhook } = require('./outbound-webhooks');
const { existsEvmTransaction } = require('./evm');
const { quoteSatsFromFiat, createZbdCharge } = require('./zbd');

const CRYPTO_PAYMENT_MIN_CONFIRMATIONS = Number(process.env.CRYPTO_PAYMENT_MIN_CONFIRMATIONS || 200);
const CRYPTO_PAYMENT_TIMEOUT_MINUTES = Number(process.env.CRYPTO_PAYMENT_TIMEOUT_MINUTES || 20);
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.CHAIN_RATE_LIMIT_COOLDOWN_MS || 120000);

const chainModules = {
  hive: HIVEModule,
  hbd: HBDModule,
  steem: STEEMModule,
  sbd: SBDModule,
  blurt: BLURTModule,
  tlos: TLOSModule,
  eos: EOSModule,
  fio: FIOModule,
  wax: WAXModule,
  pivx: PIVXModule,
  fls: FLSModule
};

function getTokenConfig(methodId) {
  const token = supportedTokens[String(methodId || '').toLowerCase()] || null;
  if (!token || token.enabled === false) {
    return null;
  }
  return token;
}

function getTokenWalletKey(methodId) {
  const tokenConfig = getTokenConfig(methodId);
  if (!tokenConfig) return null;
  return tokenConfig.walletKey || `${String(methodId || '').toLowerCase()}Address`;
}

function isEvmMethod(methodId) {
  return getTokenConfig(methodId)?.chainType === 'evm';
}

function isZbdMethod(methodId) {
  return String(methodId || '').toLowerCase() === 'zbd';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function sanitizeStore(store) {
  const currentGatewayState = deriveGatewayState(decryptStoreConfig(store).secrets, store.wallets || {});
  return {
    id: store.id,
    ownerUserId: store.ownerUserId,
    name: store.name,
    slug: store.slug,
    hookId: store.hookId,
    status: store.status,
    defaultCurrency: store.defaultCurrency,
    supportedDisplayCurrencies: store.supportedDisplayCurrencies,
    theme: store.theme,
    taxRate: store.taxRate,
    products: store.products,
    apiKeys: {
      publicKey: store.apiKeys?.publicKey || null,
      secretKeyLast4: store.apiKeys?.secretKeyLast4 || null
    },
    wallets: {
      hiveAddress: store.wallets?.hiveAddress || '',
      hbdAddress: store.wallets?.hbdAddress || '',
      steemAddress: store.wallets?.steemAddress || '',
      sbdAddress: store.wallets?.sbdAddress || '',
      blurtAddress: store.wallets?.blurtAddress || '',
      ethAddress: store.wallets?.ethAddress || '',
      polAddress: store.wallets?.polAddress || '',
      bnbAddress: store.wallets?.bnbAddress || '',
      tlosAddress: store.wallets?.tlosAddress || '',
      eosAddress: store.wallets?.eosAddress || '',
      fioPublicKey: store.wallets?.fioPublicKey || '',
      waxAddress: store.wallets?.waxAddress || '',
      pivxAddress: store.wallets?.pivxAddress || '',
      flsAddress: store.wallets?.flsAddress || '',
      zbdReceiverType: store.wallets?.zbdReceiverType || '',
      zbdGamertag: store.wallets?.zbdGamertag || '',
      zbdLightningAddress: store.wallets?.zbdLightningAddress || ''
    },
    configPreview: {
      stripeSecretKeyConfigured: Boolean(store.gatewaySecrets?.stripeSecretKey),
      stripeWebhookSecretConfigured: Boolean(store.gatewaySecrets?.stripeWebhookSecret),
      paypalClientIdConfigured: Boolean(store.gatewaySecrets?.paypalClientId),
      paypalClientSecretConfigured: Boolean(store.gatewaySecrets?.paypalClientSecret),
      paypalWebhookIdConfigured: Boolean(store.gatewaySecrets?.paypalWebhookId),
      nowpaymentsApiKeyConfigured: Boolean(store.gatewaySecrets?.nowpaymentsApiKey),
      nowpaymentsIpnSecretConfigured: Boolean(store.gatewaySecrets?.nowpaymentsIpnSecret),
      zbdApiKeyConfigured: Boolean(store.gatewaySecrets?.zbdApiKey)
    },
    gatewayState: currentGatewayState,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt
  };
}

function deriveGatewayState(secrets = {}, wallets = {}) {
  return {
    stripe: Boolean(secrets.stripeSecretKey),
    paypal: Boolean(secrets.paypalClientId && secrets.paypalClientSecret),
    nowpayments: Boolean(secrets.nowpaymentsApiKey),
    hive: Boolean(wallets.hiveAddress),
    hbd: Boolean(wallets.hbdAddress),
    steem: Boolean(wallets.steemAddress),
    sbd: Boolean(wallets.sbdAddress),
    blurt: Boolean(wallets.blurtAddress),
    eth: Boolean(getTokenConfig('eth') && wallets.ethAddress),
    pol: Boolean(getTokenConfig('pol') && wallets.polAddress),
    bnb: Boolean(getTokenConfig('bnb') && wallets.bnbAddress),
    myst: Boolean(getTokenConfig('myst') && wallets.polAddress),
    usdt_pol: Boolean(getTokenConfig('usdt_pol') && wallets.polAddress),
    usdc_pol: Boolean(getTokenConfig('usdc_pol') && wallets.polAddress),
    usdt_eth: Boolean(getTokenConfig('usdt_eth') && wallets.ethAddress),
    usdc_eth: Boolean(getTokenConfig('usdc_eth') && wallets.ethAddress),
    usdt_bnb: Boolean(getTokenConfig('usdt_bnb') && wallets.bnbAddress),
    usdc_bnb: Boolean(getTokenConfig('usdc_bnb') && wallets.bnbAddress),
    tlos: Boolean(wallets.tlosAddress),
    eos: Boolean(wallets.eosAddress),
    fio: Boolean(wallets.fioPublicKey),
    wax: Boolean(wallets.waxAddress),
    pivx: Boolean(wallets.pivxAddress),
    fls: Boolean(wallets.flsAddress),
    zbd: Boolean(
      (secrets.zbdApiKey || process.env.ZBD_API_KEY)
      && (
        (String(wallets.zbdReceiverType || '').toLowerCase() === 'lightningaddress' && wallets.zbdLightningAddress)
        || (String(wallets.zbdReceiverType || '').toLowerCase() !== 'lightningaddress' && wallets.zbdGamertag)
        || wallets.zbdGamertag
        || wallets.zbdLightningAddress
      )
    )
  };
}

function buildSecretPayload(input) {
  return {
    stripeSecretKey: encryptSecret(input.stripeSecretKey),
    stripeWebhookSecret: encryptSecret(input.stripeWebhookSecret),
    paypalClientId: encryptSecret(input.paypalClientId),
    paypalClientSecret: encryptSecret(input.paypalClientSecret),
    paypalWebhookId: encryptSecret(input.paypalWebhookId),
    nowpaymentsApiKey: encryptSecret(input.nowpaymentsApiKey),
    nowpaymentsIpnSecret: encryptSecret(input.nowpaymentsIpnSecret),
    zbdApiKey: encryptSecret(input.zbdApiKey)
  };
}

function buildWalletPayload(input) {
  return {
    hiveAddress: input.hiveAddress || '',
    hbdAddress: input.hbdAddress || '',
    steemAddress: input.steemAddress || '',
    sbdAddress: input.sbdAddress || '',
    blurtAddress: input.blurtAddress || '',
    ethAddress: input.ethAddress || '',
    polAddress: input.polAddress || '',
    bnbAddress: input.bnbAddress || '',
    tlosAddress: input.tlosAddress || '',
    eosAddress: input.eosAddress || '',
    fioPublicKey: input.fioPublicKey || '',
    waxAddress: input.waxAddress || '',
    pivxAddress: input.pivxAddress || '',
    flsAddress: input.flsAddress || '',
    zbdReceiverType: input.zbdReceiverType || '',
    zbdGamertag: input.zbdGamertag || '',
    zbdLightningAddress: input.zbdLightningAddress || ''
  };
}

function decryptStoreConfig(store) {
  return {
    secrets: {
      stripeSecretKey: decryptSecret(store.gatewaySecrets?.stripeSecretKey),
      stripeWebhookSecret: decryptSecret(store.gatewaySecrets?.stripeWebhookSecret),
      paypalClientId: decryptSecret(store.gatewaySecrets?.paypalClientId),
      paypalClientSecret: decryptSecret(store.gatewaySecrets?.paypalClientSecret),
      paypalWebhookId: decryptSecret(store.gatewaySecrets?.paypalWebhookId),
      nowpaymentsApiKey: decryptSecret(store.gatewaySecrets?.nowpaymentsApiKey),
      nowpaymentsIpnSecret: decryptSecret(store.gatewaySecrets?.nowpaymentsIpnSecret),
      zbdApiKey: decryptSecret(store.gatewaySecrets?.zbdApiKey) || process.env.ZBD_API_KEY || ''
    },
    wallets: {
      hiveAddress: store.wallets?.hiveAddress || '',
      hbdAddress: store.wallets?.hbdAddress || '',
      steemAddress: store.wallets?.steemAddress || '',
      sbdAddress: store.wallets?.sbdAddress || '',
      blurtAddress: store.wallets?.blurtAddress || '',
      ethAddress: store.wallets?.ethAddress || '',
      polAddress: store.wallets?.polAddress || '',
      bnbAddress: store.wallets?.bnbAddress || '',
      tlosAddress: store.wallets?.tlosAddress || '',
      eosAddress: store.wallets?.eosAddress || '',
      fioPublicKey: store.wallets?.fioPublicKey || '',
      waxAddress: store.wallets?.waxAddress || '',
      pivxAddress: store.wallets?.pivxAddress || '',
      flsAddress: store.wallets?.flsAddress || '',
      zbdReceiverType: store.wallets?.zbdReceiverType || '',
      zbdGamertag: store.wallets?.zbdGamertag || '',
      zbdLightningAddress: store.wallets?.zbdLightningAddress || ''
    }
  };
}

function buildAttemptTiming(tokenConfig = null) {
  if (!tokenConfig) {
    return {
      confirmationTarget: null,
      expiresAt: null
    };
  }
  return {
    confirmationTarget: Number(tokenConfig.minimumConfirmations ?? CRYPTO_PAYMENT_MIN_CONFIRMATIONS),
    expiresAt: new Date(Date.now() + (CRYPTO_PAYMENT_TIMEOUT_MINUTES * 60 * 1000)).toISOString()
  };
}

function isAttemptExpired(attempt) {
  return Boolean(attempt?.expiresAt) && new Date(attempt.expiresAt).getTime() <= Date.now();
}

function isAttemptCoolingDown(attempt) {
  return Boolean(attempt?.rateLimitedUntil) && new Date(attempt.rateLimitedUntil).getTime() > Date.now();
}

function isRateLimitError(error) {
  const status = Number(error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return status === 429
    || status === 403
    || message.includes('rate limit')
    || message.includes('too many requests');
}

async function markAttemptRateLimited(attempt, error) {
  return updatePaymentAttempt(attempt.id, () => ({
    status: 'pending',
    rateLimited: true,
    rateLimitedUntil: new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString(),
    lastError: error?.message || 'Rate limited by upstream API',
    lastErrorCode: Number(error?.response?.status || 429)
  }));
}

function getZbdReceiverConfig(wallets = {}) {
  const requested = String(wallets.zbdReceiverType || '').trim().toLowerCase();
  const normalized = ['lightningaddress', 'lnaddress', 'ln-address'].includes(requested)
    ? 'lightningaddress'
    : 'gamertag';

  return {
    receiverType: normalized,
    gamertag: wallets.zbdGamertag || '',
    lightningAddress: wallets.zbdLightningAddress || ''
  };
}

async function buildOnchainPaymentInstructions(store, amount, currency, methodId, referenceId) {
  const config = decryptStoreConfig(store);
  const tokenConfig = getTokenConfig(methodId);
  const walletKey = getTokenWalletKey(methodId);
  const walletAddress = config.wallets[walletKey];

  if (!walletAddress) {
    throw new Error(`${String(methodId || '').toUpperCase()} wallet is not configured`);
  }

  const quote = await quoteTokenAmount(String(methodId || '').toLowerCase(), amount, currency);
  const memo = tokenConfig?.memo ? `${String(methodId || '').toLowerCase()}-${store.hookId}-${referenceId}` : null;

  return {
    providerReference: referenceId,
    status: 'pending',
    redirectUrl: null,
    instructions: {
      address: walletAddress,
      amount: quote.amount,
      currency: tokenConfig?.invoiceSymbol || quote.symbol,
      memo,
      contract: tokenConfig?.contract || null,
      note: tokenConfig?.note || null,
      network: tokenConfig?.network || null
    },
    providerPayload: quote
  };
}

async function checkSupportedOnchainTransaction(attempt, createdAt) {
  const tokenConfig = getTokenConfig(attempt.methodId) || {};
  const minimumConfirmations = Number(
    tokenConfig.minimumConfirmations
    ?? attempt.confirmationTarget
    ?? CRYPTO_PAYMENT_MIN_CONFIRMATIONS
  );

  if (isEvmMethod(attempt.methodId)) {
    return existsEvmTransaction(
      attempt.instructions.address,
      attempt.instructions.amount,
      createdAt,
      tokenConfig,
      minimumConfirmations
    );
  }

  const Method = chainModules[attempt.methodId];
  if (!Method) {
    return null;
  }

  return new Method().existsTransaction(
    attempt.instructions.address,
    attempt.instructions.amount,
    createdAt,
    attempt.instructions.memo || null,
    minimumConfirmations
  );
}

function attachPaymentAttempt(entity, attempt) {
  return {
    ...entity,
    paymentAttempt: attempt || null
  };
}

async function updatePaymentAttempt(attemptId, updater) {
  return updateBy('paymentAttempts', (item) => item.id === attemptId, (item) => ({
    ...item,
    rateLimited: false,
    rateLimitedUntil: null,
    ...updater(item),
    updatedAt: new Date().toISOString()
  }));
}

async function listPaymentAttemptsForStore(storeId) {
  return (await list('paymentAttempts'))
    .filter((attempt) => attempt.storeId === storeId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function isAttemptTerminal(attempt) {
  return ['completed', 'failed', 'cancelled'].includes(String(attempt?.status || '').toLowerCase());
}

function scorePaymentAttempt(attempt) {
  const status = String(attempt?.status || '').toLowerCase();
  const hasTxid = Boolean(attempt?.transaction?.txid);
  const conf = Number(attempt?.transaction?.conf || 0);
  if (status === 'completed') return 1000000 + conf;
  if (hasTxid) return 500000 + conf;
  if (conf > 0) return 400000 + conf;
  if (status === 'pending') return 100000;
  return 0;
}

function pickBestPaymentAttempt(attempts = []) {
  return [...attempts].sort((left, right) => {
    const scoreDiff = scorePaymentAttempt(right) - scorePaymentAttempt(left);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  })[0] || null;
}

function coalescePaymentAttempts(attempts = []) {
  const best = pickBestPaymentAttempt(attempts);
  if (!best) return null;

  const sameMethod = attempts.filter((attempt) => attempt.methodId === best.methodId);
  const confirmationTargets = sameMethod
    .map((attempt) => Number(attempt.confirmationTarget))
    .filter((value) => Number.isFinite(value) && value > 0);
  const transactionSource = pickBestPaymentAttempt(
    sameMethod.filter((attempt) => attempt.transaction && (attempt.transaction.txid || Number(attempt.transaction.conf || 0) > 0))
  );

  return {
    ...best,
    confirmationTarget: confirmationTargets.length ? Math.min(...confirmationTargets) : best.confirmationTarget ?? null,
    transaction: transactionSource?.transaction || best.transaction || null
  };
}

async function getLatestPaymentAttemptForCheckout(checkoutSessionId) {
  const attempts = (await list('paymentAttempts'))
    .filter((attempt) => attempt.checkoutSessionId === checkoutSessionId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return coalescePaymentAttempts(attempts);
}

async function getLatestPaymentAttemptForOrder(orderId) {
  const attempts = (await list('paymentAttempts'))
    .filter((attempt) => attempt.orderId === orderId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return coalescePaymentAttempts(attempts);
}

async function getReusableCheckoutAttempt(checkoutSessionId, methodId) {
  const attempts = (await list('paymentAttempts'))
    .filter((attempt) => attempt.checkoutSessionId === checkoutSessionId && attempt.methodId === methodId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return attempts.find((attempt) => !isAttemptTerminal(attempt)) || null;
}

async function getReusableOrderAttempt(orderId, methodId) {
  const attempts = (await list('paymentAttempts'))
    .filter((attempt) => attempt.orderId === orderId && attempt.methodId === methodId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return attempts.find((attempt) => !isAttemptTerminal(attempt)) || null;
}

async function createStoreForUser(user, payload = {}) {
  const slug = slugify(payload.slug || payload.name || `${user.name}-store`) || `store-${randomDigits(5)}`;
  const existing = await getBy('stores', (store) => store.slug === slug);
  if (existing) {
    throw new Error('Store slug is already in use');
  }

  const wallets = buildWalletPayload(payload.wallets || {});
  const gatewaySecrets = buildSecretPayload(payload.gatewaySecrets || {});
  const secretKey = generateApiKey('sk_live');
  const store = {
    id: randomId('sto_'),
    ownerUserId: user.id,
    name: payload.name || `${user.name}'s Store`,
    slug,
    hookId: randomDigits(7),
    status: 'active',
    defaultCurrency: String(payload.defaultCurrency || 'USD').toUpperCase(),
    supportedDisplayCurrencies: payload.supportedDisplayCurrencies || ['USD', 'GBP', 'EUR'],
    theme: {
      accent: '#7ddc5b',
      mode: 'dark'
    },
    taxRate: Number(payload.taxRate ?? defaultTaxRate),
    products: payload.products?.length ? payload.products : defaultProducts,
    apiKeys: {
      publicKey: generateApiKey('pk_live'),
      secretKeyHash: sha256(secretKey),
      secretKeyLast4: secretKey.slice(-4)
    },
    gatewaySecrets,
    wallets,
    gatewayState: deriveGatewayState(payload.gatewaySecrets || {}, wallets),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await append('stores', store);
  return {
    ...sanitizeStore(store),
    issuedSecretKey: secretKey
  };
}

async function getStoreByOwner(userId) {
  return getBy('stores', (store) => store.ownerUserId === userId);
}

async function getStoresByOwner(userId) {
  return (await list('stores'))
    .filter((store) => store.ownerUserId === userId)
    .map(sanitizeStore);
}

async function getStoreBySlug(slug) {
  return getBy('stores', (store) => store.slug === slug);
}

async function getStoreByHookId(hookId) {
  return getBy('stores', (store) => store.hookId === String(hookId));
}

async function getStoreBySecretApiKey(secretKey) {
  const hashed = sha256(secretKey);
  return getBy('stores', (store) => store.apiKeys?.secretKeyHash === hashed);
}

async function rotateStoreApiKey(storeId, userId, adminOverride = false) {
  const store = await getBy(
    'stores',
    (item) => item.id === storeId && (item.ownerUserId === userId || adminOverride)
  );
  if (!store) throw new Error('Store not found');

  const secretKey = generateApiKey('sk_live');
  const updated = await updateBy('stores', (item) => item.id === storeId, (item) => ({
    ...item,
    apiKeys: {
      publicKey: item.apiKeys?.publicKey || generateApiKey('pk_live'),
      secretKeyHash: sha256(secretKey),
      secretKeyLast4: secretKey.slice(-4)
    },
    updatedAt: new Date().toISOString()
  }));

  return {
    ...sanitizeStore(updated),
    issuedSecretKey: secretKey
  };
}

async function updateStore(storeId, userId, payload) {
  const store = await getBy(
    'stores',
    (item) => item.id === storeId && (item.ownerUserId === userId || payload.__adminOverride === true)
  );
  if (!store) {
    throw new Error('Store not found');
  }

  const nextSecretsInput = {
    stripeSecretKey: payload.gatewaySecrets?.stripeSecretKey || decryptSecret(store.gatewaySecrets?.stripeSecretKey),
    stripeWebhookSecret: payload.gatewaySecrets?.stripeWebhookSecret || decryptSecret(store.gatewaySecrets?.stripeWebhookSecret),
    paypalClientId: payload.gatewaySecrets?.paypalClientId || decryptSecret(store.gatewaySecrets?.paypalClientId),
    paypalClientSecret: payload.gatewaySecrets?.paypalClientSecret || decryptSecret(store.gatewaySecrets?.paypalClientSecret),
    paypalWebhookId: payload.gatewaySecrets?.paypalWebhookId || decryptSecret(store.gatewaySecrets?.paypalWebhookId),
    nowpaymentsApiKey: payload.gatewaySecrets?.nowpaymentsApiKey || decryptSecret(store.gatewaySecrets?.nowpaymentsApiKey),
    nowpaymentsIpnSecret: payload.gatewaySecrets?.nowpaymentsIpnSecret || decryptSecret(store.gatewaySecrets?.nowpaymentsIpnSecret),
    zbdApiKey: payload.gatewaySecrets?.zbdApiKey || decryptSecret(store.gatewaySecrets?.zbdApiKey)
  };
  const nextWallets = {
    hiveAddress: payload.wallets?.hiveAddress ?? store.wallets?.hiveAddress ?? '',
    hbdAddress: payload.wallets?.hbdAddress ?? store.wallets?.hbdAddress ?? '',
    steemAddress: payload.wallets?.steemAddress ?? store.wallets?.steemAddress ?? '',
    sbdAddress: payload.wallets?.sbdAddress ?? store.wallets?.sbdAddress ?? '',
    blurtAddress: payload.wallets?.blurtAddress ?? store.wallets?.blurtAddress ?? '',
    ethAddress: payload.wallets?.ethAddress ?? store.wallets?.ethAddress ?? '',
    polAddress: payload.wallets?.polAddress ?? store.wallets?.polAddress ?? '',
    bnbAddress: payload.wallets?.bnbAddress ?? store.wallets?.bnbAddress ?? '',
    tlosAddress: payload.wallets?.tlosAddress ?? store.wallets?.tlosAddress ?? '',
    eosAddress: payload.wallets?.eosAddress ?? store.wallets?.eosAddress ?? '',
    fioPublicKey: payload.wallets?.fioPublicKey ?? store.wallets?.fioPublicKey ?? '',
    waxAddress: payload.wallets?.waxAddress ?? store.wallets?.waxAddress ?? '',
    pivxAddress: payload.wallets?.pivxAddress ?? store.wallets?.pivxAddress ?? '',
    flsAddress: payload.wallets?.flsAddress ?? store.wallets?.flsAddress ?? '',
    zbdReceiverType: payload.wallets?.zbdReceiverType ?? store.wallets?.zbdReceiverType ?? '',
    zbdGamertag: payload.wallets?.zbdGamertag ?? store.wallets?.zbdGamertag ?? '',
    zbdLightningAddress: payload.wallets?.zbdLightningAddress ?? store.wallets?.zbdLightningAddress ?? ''
  };

  const updated = await updateBy('stores', (item) => item.id === storeId, (item) => ({
    ...item,
    name: payload.name ?? item.name,
    defaultCurrency: payload.defaultCurrency ? String(payload.defaultCurrency).toUpperCase() : item.defaultCurrency,
    supportedDisplayCurrencies: payload.supportedDisplayCurrencies ?? item.supportedDisplayCurrencies,
    taxRate: payload.taxRate ?? item.taxRate,
    products: payload.products ?? item.products,
    status: payload.status ?? item.status,
    gatewaySecrets: buildSecretPayload(nextSecretsInput),
    wallets: nextWallets,
    gatewayState: deriveGatewayState(nextSecretsInput, nextWallets),
    updatedAt: new Date().toISOString()
  }));

  return sanitizeStore(updated);
}

async function listStoresForUser(user) {
  if (user.role === 'admin') {
    return (await list('stores')).map(sanitizeStore);
  }

  return (await list('stores'))
    .filter((store) => store.ownerUserId === user.id)
    .map(sanitizeStore);
}

async function createIssue(storeId, user, payload) {
  const issue = {
    id: randomId('iss_'),
    storeId,
    userId: user.id,
    title: payload.title || 'Untitled issue',
    message: payload.message || '',
    status: 'open',
    createdAt: new Date().toISOString()
  };

  await append('issues', issue);
  return issue;
}

async function createHostedCheckoutSession(store, payload = {}) {
  const gatewayState = deriveGatewayState(decryptStoreConfig(store).secrets, store.wallets || {});
  const enabledMethods = Object.entries(gatewayState || {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const requestedMethods = Array.isArray(payload.allowedMethods) && payload.allowedMethods.length
    ? payload.allowedMethods.map((item) => String(item).toLowerCase())
    : enabledMethods;
  const allowedMethods = requestedMethods.filter((method) => enabledMethods.includes(method));
  if (!allowedMethods.length) {
    throw new Error('No enabled payment methods are available for this store');
  }

  const session = {
    id: randomId('chk_'),
    storeId: store.id,
    ownerUserId: store.ownerUserId,
    hookId: store.hookId,
    status: 'created',
    externalId: payload.externalId || null,
    itemName: payload.itemName || payload.name || 'Checkout Item',
    itemDescription: payload.itemDescription || payload.description || '',
    amount: Number(payload.amount),
    currency: String(payload.currency || store.defaultCurrency).toUpperCase(),
    displayCurrency: String(payload.displayCurrency || payload.currency || store.defaultCurrency).toUpperCase(),
    notificationUrl: payload.notificationUrl || payload.webhookUrl || '',
    successUrl: payload.successUrl || '',
    cancelUrl: payload.cancelUrl || '',
    customer: payload.customer || {},
    metadata: payload.metadata || {},
    allowedMethods,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await append('checkoutSessions', session);
  await sendMerchantWebhook(session, 'Created', 'checkout.created');
  return session;
}

async function listHostedCheckoutSessions(storeId) {
  return (await list('checkoutSessions'))
    .filter((session) => session.storeId === storeId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getHostedCheckoutSession(sessionId) {
  return getBy('checkoutSessions', (session) => session.id === sessionId);
}

async function markHostedCheckoutSessionStatus(sessionId, status, payment = null) {
  const updated = await updateBy('checkoutSessions', (session) => session.id === sessionId, (session) => ({
    ...session,
    status,
    payment: payment || session.payment || null,
    updatedAt: new Date().toISOString()
  }));
  return updated;
}

async function createPublicOrder(store, payload) {
  const displayCurrency = String(payload.displayCurrency || store.defaultCurrency).toUpperCase();
  const items = (payload.items || [])
    .map((entry) => {
      const product = (store.products || []).find((item) => item.id === entry.productId);
      if (!product) return null;
      const quantity = Math.max(1, Number(entry.quantity || 1));
      const lineTotal = Number((Number(product.price) * quantity).toFixed(2));
      return {
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice: Number(product.price),
        lineTotal
      };
    })
    .filter(Boolean);

  if (!items.length) {
    throw new Error('No valid products selected');
  }

  const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const tax = Number((subtotal * Number(store.taxRate || 0)).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const convertedTotal = await convertAmount(total, store.defaultCurrency, displayCurrency);

  const order = {
    id: randomId('ord_'),
    storeId: store.id,
    ownerUserId: store.ownerUserId,
    status: 'pending',
    displayCurrency,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customer: {
      email: payload.email || '',
      fullName: payload.fullName || '',
      postalCode: payload.postalCode || ''
    },
    items,
    totals: {
      subtotal,
      tax,
      total,
      storeCurrency: store.defaultCurrency,
      displayCurrency,
      displayTotal: convertedTotal
    }
  };

  await append('orders', order);
  return order;
}

async function createPaymentAttempt(store, order, methodId, req) {
  const config = decryptStoreConfig(store);
  let payment = null;
  const normalized = String(methodId || '').toLowerCase();
  const existingAttempt = await getReusableOrderAttempt(order.id, normalized);
  if (existingAttempt) {
    return existingAttempt;
  }
  const attemptTiming = normalized === 'zbd'
    ? {
        confirmationTarget: null,
        expiresAt: new Date(Date.now() + (CRYPTO_PAYMENT_TIMEOUT_MINUTES * 60 * 1000)).toISOString()
      }
    : getTokenConfig(normalized)
      ? buildAttemptTiming(getTokenConfig(normalized))
      : { confirmationTarget: null, expiresAt: null };

  if (normalized === 'stripe') {
    const stripe = new Stripe(config.secrets.stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${appBaseUrl}/s/${store.slug}?orderId=${order.id}&result=success`,
      cancel_url: `${appBaseUrl}/s/${store.slug}?orderId=${order.id}&result=cancelled`,
      customer_email: order.customer.email || undefined,
      metadata: {
        orderId: order.id,
        storeId: store.id,
        hookId: store.hookId
      },
      line_items: order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: store.defaultCurrency.toLowerCase(),
          product_data: { name: item.name },
          unit_amount: Math.round(Number(item.unitPrice) * 100)
        }
      }))
    });
    payment = {
      provider: 'stripe',
      providerReference: session.id,
      status: session.status || 'open',
      redirectUrl: session.url,
      instructions: null,
      providerPayload: session
    };
  } else if (normalized === 'paypal') {
    const authToken = Buffer.from(`${config.secrets.paypalClientId}:${config.secrets.paypalClientSecret}`).toString('base64');
    const { data } = await axios.post(
      'https://api-m.paypal.com/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: store.defaultCurrency,
              value: order.totals.total.toFixed(2)
            },
            description: `Order ${order.id}`
          }
        ],
        payer: {
          email_address: order.customer.email || undefined
        }
      },
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    payment = {
      provider: 'paypal',
      providerReference: data.id,
      status: data.status,
      redirectUrl: (data.links || []).find((link) => link.rel === 'approve')?.href || null,
      instructions: null,
      providerPayload: data
    };
  } else if (normalized === 'nowpayments') {
    const { data } = await axios.post(
      'https://api.nowpayments.io/v1/payment',
      {
        price_amount: order.totals.total,
        price_currency: store.defaultCurrency.toLowerCase(),
        pay_currency: req.body?.payCurrency || 'btc',
        order_id: order.id,
        order_description: `Order ${order.id}`,
        ipn_callback_url: `${appBaseUrl}/webhooks/nowpayments/${store.hookId}`
      },
      {
        headers: {
          'x-api-key': config.secrets.nowpaymentsApiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    payment = {
      provider: 'nowpayments',
      providerReference: String(data.payment_id),
      status: data.payment_status || 'waiting',
      redirectUrl: data.invoice_url || null,
      instructions: {
        address: data.pay_address,
        amount: data.pay_amount,
        currency: data.pay_currency,
        network: data.network
      },
      providerPayload: data
    };
  } else if (normalized === 'zbd') {
    if (!config.secrets.zbdApiKey) {
      throw new Error('ZBD API key is not configured');
    }

    const receiver = getZbdReceiverConfig(config.wallets);
    if (receiver.receiverType === 'lightningaddress' && !receiver.lightningAddress) {
      throw new Error('ZBD lightning address is not configured');
    }
    if (receiver.receiverType === 'gamertag' && !receiver.gamertag) {
      throw new Error('ZBD gamertag is not configured');
    }

    const quote = await quoteSatsFromFiat(order.totals.total, store.defaultCurrency);
    const internalId = JSON.stringify({
      type: 'order',
      orderId: order.id,
      storeId: store.id
    });
    const charge = await createZbdCharge({
      apiKey: config.secrets.zbdApiKey,
      receiverType: receiver.receiverType,
      gamertag: receiver.gamertag,
      lightningAddress: receiver.lightningAddress,
      amountMsats: quote.msats,
      description: `Order ${order.id}`,
      internalId,
      callbackUrl: `${appBaseUrl}/webhooks/zbd/${store.hookId}`
    });
    payment = {
      provider: 'zbd',
      providerReference: charge.providerReference,
      status: 'pending',
      redirectUrl: null,
      instructions: {
        amount: String(quote.sats),
        currency: 'SAT',
        receiverType: receiver.receiverType,
        address: receiver.receiverType === 'lightningaddress' ? receiver.lightningAddress : receiver.gamertag,
        invoiceRequest: charge.invoiceRequest,
        note: receiver.receiverType === 'lightningaddress' ? 'Lightning address invoice' : 'ZBD gamertag invoice',
        invoiceExpiresAt: charge.invoiceExpiresAt || attemptTiming.expiresAt
      },
      providerPayload: charge.providerPayload
    };
  } else if (getTokenConfig(normalized)) {
    payment = await buildOnchainPaymentInstructions(
      store,
      order.totals.total,
      store.defaultCurrency,
      normalized,
      order.id
    );
  } else {
    throw new Error('Unsupported payment method');
  }

  const attempt = {
    id: randomId('pay_'),
    orderId: order.id,
    storeId: store.id,
    methodId: normalized,
    providerReference: payment.providerReference,
    status: payment.status,
    redirectUrl: payment.redirectUrl,
    instructions: payment.instructions,
    providerPayload: payment.providerPayload,
    confirmationTarget: attemptTiming.confirmationTarget,
    expiresAt: attemptTiming.expiresAt,
    transaction: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await append('paymentAttempts', attempt);
  return attempt;
}

async function createHostedCheckoutPayment(store, session, methodId, req) {
  if (req.body?.customer) {
    session = await updateBy('checkoutSessions', (item) => item.id === session.id, (item) => ({
      ...item,
      customer: {
        ...item.customer,
        ...req.body.customer
      },
      updatedAt: new Date().toISOString()
    })) || session;
  }
  const config = decryptStoreConfig(store);
  const normalized = String(methodId || '').toLowerCase();
  const existingAttempt = await getReusableCheckoutAttempt(session.id, normalized);
  if (existingAttempt) {
    return existingAttempt;
  }
  const attemptTiming = normalized === 'zbd'
    ? {
        confirmationTarget: null,
        expiresAt: new Date(Date.now() + (CRYPTO_PAYMENT_TIMEOUT_MINUTES * 60 * 1000)).toISOString()
      }
    : getTokenConfig(normalized)
      ? buildAttemptTiming(getTokenConfig(normalized))
      : { confirmationTarget: null, expiresAt: null };
  let payment = null;

  if (normalized === 'stripe') {
    const stripe = new Stripe(config.secrets.stripeSecretKey);
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: session.successUrl || `${appBaseUrl}/pay/${session.id}?result=success`,
      cancel_url: session.cancelUrl || `${appBaseUrl}/pay/${session.id}?result=cancelled`,
      customer_email: session.customer?.email || undefined,
      metadata: {
        checkoutSessionId: session.id,
        storeId: store.id,
        hookId: store.hookId
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: session.currency.toLowerCase(),
          product_data: {
            name: session.itemName,
            description: session.itemDescription || undefined
          },
          unit_amount: Math.round(Number(session.amount) * 100)
        }
      }]
    });
    payment = {
      providerReference: checkout.id,
      status: 'pending',
      redirectUrl: checkout.url,
      instructions: null,
      providerPayload: checkout
    };
  } else if (normalized === 'paypal') {
    const authToken = Buffer.from(`${config.secrets.paypalClientId}:${config.secrets.paypalClientSecret}`).toString('base64');
    const { data } = await axios.post('https://api-m.paypal.com/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: session.currency,
          value: Number(session.amount).toFixed(2)
        },
        description: session.itemName
      }],
      payer: {
        email_address: session.customer?.email || undefined
      }
    }, {
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    payment = {
      providerReference: data.id,
      status: 'pending',
      redirectUrl: (data.links || []).find((link) => link.rel === 'approve')?.href || null,
      instructions: null,
      providerPayload: data
    };
  } else if (normalized === 'nowpayments') {
    const { data } = await axios.post('https://api.nowpayments.io/v1/payment', {
      price_amount: session.amount,
      price_currency: session.currency.toLowerCase(),
      pay_currency: req.body?.payCurrency || 'btc',
      order_id: session.id,
      order_description: session.itemName,
      ipn_callback_url: `${appBaseUrl}/webhooks/nowpayments/${store.hookId}`
    }, {
      headers: {
        'x-api-key': config.secrets.nowpaymentsApiKey,
        'Content-Type': 'application/json'
      }
    });
    payment = {
      providerReference: String(data.payment_id),
      status: 'pending',
      redirectUrl: data.invoice_url || null,
      instructions: {
        address: data.pay_address,
        amount: data.pay_amount,
        currency: data.pay_currency,
        network: data.network
      },
      providerPayload: data
    };
  } else if (normalized === 'zbd') {
    if (!config.secrets.zbdApiKey) {
      throw new Error('ZBD API key is not configured');
    }

    const receiver = getZbdReceiverConfig(config.wallets);
    if (receiver.receiverType === 'lightningaddress' && !receiver.lightningAddress) {
      throw new Error('ZBD lightning address is not configured');
    }
    if (receiver.receiverType === 'gamertag' && !receiver.gamertag) {
      throw new Error('ZBD gamertag is not configured');
    }

    const quote = await quoteSatsFromFiat(session.amount, session.currency);
    const internalId = JSON.stringify({
      type: 'checkout',
      checkoutSessionId: session.id,
      storeId: store.id
    });
    const charge = await createZbdCharge({
      apiKey: config.secrets.zbdApiKey,
      receiverType: receiver.receiverType,
      gamertag: receiver.gamertag,
      lightningAddress: receiver.lightningAddress,
      amountMsats: quote.msats,
      description: session.itemName,
      internalId,
      callbackUrl: `${appBaseUrl}/webhooks/zbd/${store.hookId}`
    });
    payment = {
      providerReference: charge.providerReference,
      status: 'pending',
      redirectUrl: null,
      instructions: {
        amount: String(quote.sats),
        currency: 'SAT',
        receiverType: receiver.receiverType,
        address: receiver.receiverType === 'lightningaddress' ? receiver.lightningAddress : receiver.gamertag,
        invoiceRequest: charge.invoiceRequest,
        note: receiver.receiverType === 'lightningaddress' ? 'Lightning address invoice' : 'ZBD gamertag invoice',
        invoiceExpiresAt: charge.invoiceExpiresAt || attemptTiming.expiresAt
      },
      providerPayload: charge.providerPayload
    };
  } else if (getTokenConfig(normalized)) {
    payment = await buildOnchainPaymentInstructions(
      store,
      session.amount,
      session.currency,
      normalized,
      session.id
    );
  } else {
    throw new Error('Unsupported payment method');
  }

  const attempt = {
    id: randomId('pay_'),
    checkoutSessionId: session.id,
    storeId: store.id,
    methodId: normalized,
    providerReference: payment.providerReference,
    status: payment.status,
    redirectUrl: payment.redirectUrl,
    instructions: payment.instructions,
    providerPayload: payment.providerPayload,
    confirmationTarget: attemptTiming.confirmationTarget,
    expiresAt: attemptTiming.expiresAt,
    transaction: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await append('paymentAttempts', attempt);
  const updatedSession = await markHostedCheckoutSessionStatus(session.id, 'Pending', {
    methodId: normalized,
    providerReference: payment.providerReference,
    instructions: payment.instructions
  });
  await sendMerchantWebhook(updatedSession, 'Pending', 'checkout.pending', { payment: updatedSession.payment });
  return attempt;
}

async function refreshHostedCheckoutStatus(store, session) {
  let attempt = await getBy('paymentAttempts', (item) => item.checkoutSessionId === session.id);
  if (!attempt) return attachPaymentAttempt(session, null);
  if (isAttemptCoolingDown(attempt)) return attachPaymentAttempt(session, attempt);

  if (attempt.methodId === 'nowpayments') {
    const config = decryptStoreConfig(store);
    const { data } = await axios.get(`https://api.nowpayments.io/v1/payment/${attempt.providerReference}`, {
      headers: { 'x-api-key': config.secrets.nowpaymentsApiKey }
    });
    if (['finished', 'confirmed', 'sending', 'partially_paid'].includes(data.payment_status)) {
      const updated = await markHostedCheckoutSessionStatus(session.id, 'Completed', {
        ...session.payment,
        providerReference: attempt.providerReference
      });
      attempt = await updatePaymentAttempt(attempt.id, () => ({
        status: 'completed',
        transaction: {
          txid: String(attempt.providerReference),
          conf: null,
          address: attempt.instructions?.address || null,
          amount: attempt.instructions?.amount || null,
          currency: attempt.instructions?.currency || null,
          memo: attempt.instructions?.memo || null
        }
      }));
      await sendMerchantWebhook(updated, 'Completed', 'checkout.completed', { payment: updated.payment });
      return attachPaymentAttempt(updated, attempt);
    }
    return attachPaymentAttempt(session, attempt);
  }

  if (attempt.methodId === 'zbd') {
    if (isAttemptExpired(attempt)) {
      attempt = await updatePaymentAttempt(attempt.id, () => ({ status: 'failed' }));
      const failed = await markHostedCheckoutSessionStatus(session.id, 'Failed', {
        ...(session.payment || {}),
        methodId: attempt.methodId,
        providerReference: attempt.providerReference,
        instructions: attempt.instructions
      });
      await sendMerchantWebhook(failed, 'Failed', 'checkout.failed', { payment: failed.payment });
      return attachPaymentAttempt(failed, attempt);
    }

    return attachPaymentAttempt(session, attempt);
  }

  if (getTokenConfig(attempt.methodId)) {
    if (isAttemptExpired(attempt)) {
      attempt = await updatePaymentAttempt(attempt.id, () => ({ status: 'failed' }));
      const failed = await markHostedCheckoutSessionStatus(session.id, 'Failed', {
        ...(session.payment || {}),
        methodId: attempt.methodId,
        providerReference: attempt.providerReference,
        instructions: attempt.instructions
      });
      await sendMerchantWebhook(failed, 'Failed', 'checkout.failed', { payment: failed.payment });
      return attachPaymentAttempt(failed, attempt);
    }

    let tx;
    try {
      tx = await checkSupportedOnchainTransaction(attempt, session.createdAt);
    } catch (error) {
      if (isRateLimitError(error)) {
        attempt = await markAttemptRateLimited(attempt, error);
        return attachPaymentAttempt(session, attempt);
      }
      throw error;
    }
    attempt = await updatePaymentAttempt(attempt.id, () => ({
      status: tx.exists ? 'completed' : 'pending',
      transaction: tx.conf !== '' ? {
        txid: tx.txid || null,
        conf: Number(tx.conf || 0),
        address: attempt.instructions?.address || null,
        amount: attempt.instructions?.amount || null,
        currency: attempt.instructions?.currency || null,
        memo: attempt.instructions?.memo || null,
        contract: attempt.instructions?.contract || null
      } : null
    }));
    if (tx.exists) {
      const updated = await markHostedCheckoutSessionStatus(session.id, 'Completed', {
        methodId: attempt.methodId,
        providerReference: tx.txid,
        instructions: attempt.instructions,
        transaction: attempt.transaction
      });
      await sendMerchantWebhook(updated, 'Completed', 'checkout.completed', { payment: updated.payment });
      return attachPaymentAttempt(updated, attempt);
    }
  }

  return attachPaymentAttempt(session, attempt);
}

async function checkManualPaymentStatus(store, order, attempt) {
  if (attempt.methodId === 'zbd') {
    if (isAttemptExpired(attempt)) {
      await updatePaymentAttempt(attempt.id, () => ({ status: 'failed' }));
      await updateBy('orders', (item) => item.id === order.id, (item) => ({
        ...item,
        status: 'failed',
        updatedAt: new Date().toISOString()
      }));
    }
    return null;
  }

  if (!getTokenConfig(attempt.methodId)) return null;
  if (isAttemptCoolingDown(attempt)) return attempt;
  if (isAttemptExpired(attempt)) {
    await updatePaymentAttempt(attempt.id, () => ({ status: 'failed' }));
    await updateBy('orders', (item) => item.id === order.id, (item) => ({
      ...item,
      status: 'failed',
      updatedAt: new Date().toISOString()
    }));
    return null;
  }
  let tx;
  try {
    tx = await checkSupportedOnchainTransaction(attempt, order.createdAt);
  } catch (error) {
    if (isRateLimitError(error)) {
      return markAttemptRateLimited(attempt, error);
    }
    throw error;
  }
  const updatedAttempt = await updatePaymentAttempt(attempt.id, () => ({
    status: tx.exists ? 'completed' : 'pending',
    transaction: tx.conf !== '' ? {
      txid: tx.txid || null,
      conf: Number(tx.conf || 0),
      address: attempt.instructions?.address || null,
      amount: attempt.instructions?.amount || null,
      currency: attempt.instructions?.currency || null,
      memo: attempt.instructions?.memo || null,
      contract: attempt.instructions?.contract || null
    } : null
  }));

  if (!tx.exists) {
    return updatedAttempt;
  }

  await updateBy('orders', (item) => item.id === order.id, (item) => ({
    ...item,
    status: 'paid',
    updatedAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
    payment: {
      methodId: attempt.methodId,
      providerReference: tx.txid
    }
  }));

  return updatedAttempt;
}

async function checkNowPaymentsStatus(store, order, attempt) {
  const config = decryptStoreConfig(store);
  const { data } = await axios.get(`https://api.nowpayments.io/v1/payment/${attempt.providerReference}`, {
    headers: { 'x-api-key': config.secrets.nowpaymentsApiKey }
  });

  if (['finished', 'confirmed', 'sending', 'partially_paid'].includes(data.payment_status)) {
    await updateBy('orders', (item) => item.id === order.id, (item) => ({
      ...item,
      status: 'paid',
      updatedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      payment: {
        methodId: attempt.methodId,
        providerReference: attempt.providerReference
      }
    }));
  }

  return data;
}

function verifyNowPaymentsSignature(store, payload, signature) {
  const secret = decryptStoreConfig(store).secrets.nowpaymentsIpnSecret;
  if (!secret) {
    return true;
  }

  const sortDeep = (input) => {
    if (Array.isArray(input)) return input.map(sortDeep);
    if (!input || typeof input !== 'object') return input;
    return Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = sortDeep(input[key]);
      return acc;
    }, {});
  };

  const digest = require('crypto')
    .createHmac('sha512', secret)
    .update(JSON.stringify(sortDeep(payload)))
    .digest('hex');

  return digest === signature;
}

module.exports = {
  sanitizeStore,
  decryptStoreConfig,
  createStoreForUser,
  getStoreByOwner,
  getStoresByOwner,
  getStoreBySlug,
  getStoreByHookId,
  updateStore,
  listStoresForUser,
  createIssue,
  getStoreBySecretApiKey,
  rotateStoreApiKey,
  createHostedCheckoutSession,
  listHostedCheckoutSessions,
  getHostedCheckoutSession,
  markHostedCheckoutSessionStatus,
  createHostedCheckoutPayment,
  refreshHostedCheckoutStatus,
  createPublicOrder,
  createPaymentAttempt,
  getLatestPaymentAttemptForCheckout,
  getLatestPaymentAttemptForOrder,
  checkManualPaymentStatus,
  checkNowPaymentsStatus,
  verifyNowPaymentsSignature
};
