'use strict';

const crypto = require('crypto');
const { append, getBy, list } = require('../lib/app-store');
const { createHostedCheckoutSession, sanitizeStore } = require('./platform');

const ELIGIBLE_TIERS = new Set(['affiliate', 'verified', 'partner']);
const PRODUCT_TYPES = new Set(['tip', 'nyatreat', 'subscription']);
const NYATREATS_PER_USD = 100;

function baseUrl() {
  return String(process.env.PUBLIC_URL || process.env.APP_URL || 'https://pay.nekolive.co.uk').replace(/\/+$/, '');
}

function signingSecret() {
  const value = process.env.NEKOLIVE_LINK_SIGNING_SECRET || process.env.NEKOLIVE_SERVICE_API_KEY || process.env.NEKOPAY_SERVICE_API_KEY;
  if (!value) throw new Error('NEKOLIVE_SERVICE_API_KEY or NEKOLIVE_LINK_SIGNING_SECRET must be configured');
  return value;
}

function encodeState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeState(state) {
  const [body, suppliedSignature] = String(state || '').split('.');
  if (!body || !suppliedSignature) throw new Error('Invalid creator link state');
  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(suppliedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid creator link signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.expiresAt || Number(payload.expiresAt) < Date.now()) throw new Error('Creator link has expired');
  return payload;
}

function normalizeTier(value) {
  return String(value || '').trim().toLowerCase();
}

function assertEligibleTier(value) {
  const tier = normalizeTier(value);
  if (!ELIGIBLE_TIERS.has(tier)) {
    throw new Error('Creator must be Affiliate, Verified, or Partner before linking NekoPay');
  }
  return tier;
}

function integrationEventPayload(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {};
}

async function latestCreatorIntegration(creatorId) {
  const id = String(creatorId || '').trim();
  if (!id) return null;
  const events = (await list('events'))
    .filter((event) => event.type === 'creator.integration.nekolive' && String(integrationEventPayload(event).creatorId) === id)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  const latest = events[0];
  if (!latest || integrationEventPayload(latest).active === false) return null;
  return integrationEventPayload(latest);
}

async function recordIntegration(payload) {
  const event = {
    id: `evt_creator_${crypto.randomBytes(12).toString('hex')}`,
    type: 'creator.integration.nekolive',
    checkoutSessionId: null,
    targetUrl: null,
    statusCode: null,
    error: null,
    payload,
    createdAt: new Date().toISOString()
  };
  await append('events', event);
  return payload;
}

function creatorGatewayState(safeStore) {
  const state = {
    ...(safeStore?.gatewayState && typeof safeStore.gatewayState === 'object' ? safeStore.gatewayState : {})
  };
  const preview = safeStore?.configPreview || {};

  if (state.stripe) {
    state.stripe = Boolean(preview.stripeSecretKeyConfigured && preview.stripeWebhookSecretConfigured);
  }
  if (state.paypal) {
    state.paypal = Boolean(
      preview.paypalClientIdConfigured &&
      preview.paypalClientSecretConfigured &&
      preview.paypalWebhookIdConfigured
    );
  }
  if (state.nowpayments) {
    state.nowpayments = Boolean(
      preview.nowpaymentsApiKeyConfigured &&
      preview.nowpaymentsIpnSecretConfigured
    );
  }
  return state;
}

function configuredCreatorGateways(safeStore) {
  return Object.entries(creatorGatewayState(safeStore))
    .filter(([, configured]) => Boolean(configured))
    .map(([name]) => name);
}

function startLink(payload = {}) {
  const creatorId = String(payload.creatorId || payload.channelId || '').trim();
  if (!creatorId) throw new Error('creatorId is required');
  const tier = assertEligibleTier(payload.tier);
  const state = encodeState({
    platform: 'nekolive',
    creatorId,
    channelId: String(payload.channelId || creatorId),
    channelName: String(payload.channelName || payload.username || ''),
    tier,
    returnUrl: String(payload.returnUrl || ''),
    nonce: crypto.randomBytes(12).toString('hex'),
    expiresAt: Date.now() + (15 * 60 * 1000)
  });
  return {
    state,
    expiresIn: 900,
    linkUrl: `${baseUrl()}/creator/nekolive/link?state=${encodeURIComponent(state)}`
  };
}

async function completeLink(state, user, storeId) {
  const link = decodeState(state);
  if (!user) throw new Error('Login to NekoPay before linking your creator account');
  const store = await getBy('stores', (item) => item.id === String(storeId || '') && item.ownerUserId === user.id);
  if (!store) throw new Error('Selected NekoPay merchant account was not found');

  const integration = await recordIntegration({
    platform: 'nekolive',
    active: true,
    creatorId: link.creatorId,
    channelId: link.channelId,
    channelName: link.channelName,
    tier: link.tier,
    storeId: store.id,
    ownerUserId: user.id,
    linkedAt: new Date().toISOString()
  });
  return { integration, store: sanitizeStore(store), returnUrl: link.returnUrl || '' };
}

async function getCreatorStatus(creatorId) {
  const integration = await latestCreatorIntegration(creatorId);
  if (!integration) return { linked: false, creatorId: String(creatorId || '') };
  const store = await getBy('stores', (item) => item.id === integration.storeId);
  if (!store || store.status !== 'active') {
    return { linked: false, creatorId: String(creatorId || ''), reason: 'store_unavailable' };
  }
  const safeStore = sanitizeStore(store);
  const gatewayState = creatorGatewayState(safeStore);
  const configuredGateways = configuredCreatorGateways(safeStore);
  return {
    linked: true,
    ready: configuredGateways.length > 0,
    configuredGateways,
    creatorId: integration.creatorId,
    channelId: integration.channelId,
    channelName: integration.channelName,
    tier: integration.tier,
    linkedAt: integration.linkedAt,
    store: {
      id: safeStore.id,
      name: safeStore.name,
      slug: safeStore.slug,
      hookId: safeStore.hookId,
      gatewayState
    }
  };
}

async function unlinkCreator(creatorId) {
  const existing = await latestCreatorIntegration(creatorId);
  if (!existing) return { linked: false, creatorId: String(creatorId || '') };
  await recordIntegration({ ...existing, active: false, unlinkedAt: new Date().toISOString() });
  return { linked: false, creatorId: existing.creatorId };
}

function normalizeAmount(value, productType) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be greater than zero');
  const minimum = productType === 'subscription' ? 1 : productType === 'nyatreat' ? 0.01 : 0.5;
  if (amount < minimum) throw new Error(`Minimum ${productType} amount is ${minimum.toFixed(2)}`);
  if (amount > 10000) throw new Error('Creator checkout amount is too large');
  return Number(amount.toFixed(2));
}

function normalizeNyaTreatCheckout(payload) {
  const suppliedTreats = payload.nyaTreats;
  if (suppliedTreats !== undefined && suppliedTreats !== null && suppliedTreats !== '') {
    const nyaTreats = Number(suppliedTreats);
    if (!Number.isInteger(nyaTreats) || nyaTreats <= 0) throw new Error('nyaTreats must be a positive whole number');
    if (nyaTreats > 1000000) throw new Error('NyaTreat checkout is too large');
    return { nyaTreats, amount: Number((nyaTreats / NYATREATS_PER_USD).toFixed(2)) };
  }

  const amount = normalizeAmount(payload.amount, 'nyatreat');
  return { amount, nyaTreats: Math.round(amount * NYATREATS_PER_USD) };
}

async function createCreatorCheckout(payload = {}) {
  const creatorId = String(payload.creatorId || payload.channelId || '').trim();
  if (!creatorId) throw new Error('creatorId is required');
  const integration = await latestCreatorIntegration(creatorId);
  if (!integration) throw new Error('This creator has not linked NekoPay');
  assertEligibleTier(payload.tier || integration.tier);

  const productType = String(payload.productType || payload.type || 'tip').toLowerCase();
  if (!PRODUCT_TYPES.has(productType)) throw new Error('productType must be tip, nyatreat, or subscription');

  let amount;
  let nyaTreats = null;
  if (productType === 'nyatreat') {
    const converted = normalizeNyaTreatCheckout(payload);
    amount = converted.amount;
    nyaTreats = converted.nyaTreats;
  } else {
    amount = normalizeAmount(payload.amount, productType);
  }

  const store = await getBy('stores', (item) => item.id === integration.storeId && item.status === 'active');
  if (!store) throw new Error('Creator NekoPay account is unavailable');

  const safeStore = sanitizeStore(store);
  const configuredGateways = configuredCreatorGateways(safeStore);
  if (!configuredGateways.length) {
    throw new Error('Creator NekoPay setup is incomplete. Stripe/PayPal/NOWPayments require their provider webhook verification settings before creator payments can go live.');
  }

  const anonymous = payload.anonymous === true || String(payload.anonymous || '').toLowerCase() === 'true';
  const supporterUsername = anonymous ? null : (payload.supporter?.username || null);
  const labels = {
    tip: `Tip for ${integration.channelName || 'creator'}`,
    nyatreat: `${nyaTreats} NyaTreats for ${integration.channelName || 'creator'}`,
    subscription: payload.itemName || `${payload.subscriptionPlanName || 'Subscription'} to ${integration.channelName || 'creator'}`
  };
  const description = payload.description || (productType === 'nyatreat'
    ? `${nyaTreats} NyaTreats · 100 NyaTreats = $1 USD`
    : productType === 'subscription'
      ? `${payload.subscriptionPlanName || 'NekoLive subscription'}${payload.subscriptionDurationMonths ? ` · ${payload.subscriptionDurationMonths} month(s)` : ''}`
      : 'NekoLive creator support');

  const session = await createHostedCheckoutSession(store, {
    externalId: payload.externalId || `nekolive:${creatorId}:${productType}:${crypto.randomBytes(6).toString('hex')}`,
    itemName: labels[productType],
    itemDescription: description,
    amount,
    currency: productType === 'nyatreat' || productType === 'subscription' ? 'USD' : String(payload.currency || 'USD').toUpperCase(),
    displayCurrency: productType === 'nyatreat' || productType === 'subscription' ? 'USD' : String(payload.displayCurrency || payload.currency || 'USD').toUpperCase(),
    allowedMethods: payload.allowedMethods,
    notificationUrl: payload.notificationUrl || '',
    notificationSecret: payload.notificationSecret || '',
    successUrl: payload.successUrl || '',
    cancelUrl: payload.cancelUrl || '',
    customer: {
      email: String(payload.supporter?.email || payload.customer?.email || ''),
      fullName: String(payload.supporter?.name || payload.customer?.fullName || ''),
      username: anonymous ? 'Anonymous' : String(payload.supporter?.username || '')
    },
    metadata: {
      platform: 'nekolive',
      creatorId: integration.creatorId,
      channelId: integration.channelId,
      channelName: integration.channelName,
      creatorTier: integration.tier,
      productType,
      anonymous,
      supporterId: payload.supporter?.id || null,
      supporterUsername,
      message: String(payload.message || '').slice(0, 500),
      nyaTreats,
      nyaTreatsPerUsd: productType === 'nyatreat' ? NYATREATS_PER_USD : null,
      usdValue: productType === 'nyatreat' || productType === 'subscription' ? amount : null,
      subscriptionTier: productType === 'subscription' ? String(payload.subscriptionTier || 'tier1') : null,
      subscriptionPlanName: productType === 'subscription' ? String(payload.subscriptionPlanName || 'Subscription') : null,
      subscriptionDurationMonths: productType === 'subscription' ? Number(payload.subscriptionDurationMonths || 1) : null,
      subscriptionPriceCoins: productType === 'subscription' ? Number(payload.subscriptionPriceCoins || 0) : null,
      recurringIntent: productType === 'subscription'
    }
  });

  return {
    session,
    sessionId: session.id,
    checkoutUrl: `${baseUrl()}/pay/${session.id}`,
    embedUrl: `${baseUrl()}/embed/pay/${session.id}`,
    productType,
    anonymous,
    ...(productType === 'nyatreat' ? { nyaTreats, usdAmount: amount, nyaTreatsPerUsd: NYATREATS_PER_USD } : {}),
    ...(productType === 'subscription' ? {
      subscriptionTier: String(payload.subscriptionTier || 'tier1'),
      subscriptionPlanName: String(payload.subscriptionPlanName || 'Subscription'),
      subscriptionDurationMonths: Number(payload.subscriptionDurationMonths || 1),
      usdAmount: amount
    } : {})
  };
}

module.exports = {
  ELIGIBLE_TIERS,
  PRODUCT_TYPES,
  NYATREATS_PER_USD,
  creatorGatewayState,
  configuredCreatorGateways,
  startLink,
  decodeState,
  completeLink,
  getCreatorStatus,
  unlinkCreator,
  createCreatorCheckout
};
