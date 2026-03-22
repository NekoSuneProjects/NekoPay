require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const { list, getBy, updateBy, readState, closeStorage } = require('./src/lib/app-store');
const { SESSION_COOKIE, createUser, createVerificationToken, verifyEmailToken, loginUser, getUserFromToken, logoutToken, seedAdminIfNeeded } = require('./src/services/auth');
const { requireAuth, requireAdmin } = require('./src/middleware/auth');
const { platformName, supportedCurrencies, supportedTokens, defaultProducts } = require('./src/config/platform');
const { convertAmount } = require('./src/services/pricing');
const { sanitizeStore, createStoreForUser, getStoreByOwner, getStoresByOwner, getStoreBySlug, getStoreByHookId, getStoreBySecretApiKey, rotateStoreApiKey, updateStore, listStoresForUser, createIssue, createHostedCheckoutSession, listHostedCheckoutSessions, getHostedCheckoutSession, markHostedCheckoutSessionStatus, createHostedCheckoutPayment, refreshHostedCheckoutStatus, createPublicOrder, createPaymentAttempt, checkManualPaymentStatus, checkNowPaymentsStatus, verifyNowPaymentsSignature, decryptStoreConfig } = require('./src/services/platform');
const { startBackgroundWorker, stopBackgroundWorker } = require('./src/services/background-worker');

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(process.cwd(), 'public');

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ]);

  if (!origin || origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(cookieParser());
app.use(async (req, _res, next) => {
  req.user = await getUserFromToken(req.cookies?.[SESSION_COOKIE]);
  next();
});

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    verified: user.verified,
    status: user.status,
    createdAt: user.createdAt
  };
}

async function getStoreForRequestSecret(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  return getStoreBySecretApiKey(token);
}

async function getPaypalAccessToken(store) {
  const config = decryptStoreConfig(store);
  const authToken = Buffer.from(`${config.secrets.paypalClientId}:${config.secrets.paypalClientSecret}`).toString('base64');
  const { data } = await axios.post('https://api-m.paypal.com/v1/oauth2/token', 'grant_type=client_credentials', {
    headers: {
      Authorization: `Basic ${authToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return data.access_token;
}

async function verifyPaypalWebhook(store, req) {
  const config = decryptStoreConfig(store);
  if (!config.secrets.paypalWebhookId) {
    return true;
  }

  const accessToken = await getPaypalAccessToken(store);
  const { data } = await axios.post('https://api-m.paypal.com/v1/notifications/verify-webhook-signature', {
    auth_algo: req.headers['paypal-auth-algo'],
    cert_url: req.headers['paypal-cert-url'],
    transmission_id: req.headers['paypal-transmission-id'],
    transmission_sig: req.headers['paypal-transmission-sig'],
    transmission_time: req.headers['paypal-transmission-time'],
    webhook_id: config.secrets.paypalWebhookId,
    webhook_event: req.body
  }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  return data.verification_status === 'SUCCESS';
}

async function capturePaypalOrder(store, orderId) {
  const accessToken = await getPaypalAccessToken(store);
  const { data } = await axios.post(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {}, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  return data;
}

function getPaypalOrderIdFromEvent(event) {
  return event?.resource?.supplementary_data?.related_ids?.order_id
    || event?.resource?.id
    || event?.resource?.supplementary_data?.order_id
    || null;
}

async function markPaypalAttemptStatus(orderId, status, extra = {}) {
  const attempt = await getBy('paymentAttempts', (item) => item.providerReference === orderId && item.methodId === 'paypal');
  if (!attempt) {
    return null;
  }

  const nextAttempt = await updateBy('paymentAttempts', (item) => item.id === attempt.id, (item) => ({
    ...item,
    status,
    transaction: {
      txid: extra.captureId || item.transaction?.txid || null,
      conf: null,
      address: null,
      amount: item.instructions?.amount || null,
      currency: item.instructions?.currency || null,
      memo: item.instructions?.memo || null
    },
    updatedAt: new Date().toISOString()
  }));

  if (attempt.checkoutSessionId) {
    const session = await getHostedCheckoutSession(attempt.checkoutSessionId);
    if (session) {
      const sessionStatus = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Pending';
      const updatedSession = await markHostedCheckoutSessionStatus(session.id, sessionStatus, {
        methodId: 'paypal',
        providerReference: extra.captureId || orderId,
        transaction: nextAttempt.transaction
      });
      if (sessionStatus === 'Completed') {
        const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
        await sendMerchantWebhook(updatedSession, 'Completed', 'checkout.completed', { payment: updatedSession.payment });
      } else if (sessionStatus === 'Failed') {
        const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
        await sendMerchantWebhook(updatedSession, 'Failed', 'checkout.failed', { payment: updatedSession.payment });
      }
    }
  }

  if (attempt.orderId) {
    await updateBy('orders', (order) => order.id === attempt.orderId, (order) => ({
      ...order,
      status: status === 'completed' ? 'paid' : status === 'failed' ? 'failed' : order.status,
      paidAt: status === 'completed' ? new Date().toISOString() : order.paidAt,
      updatedAt: new Date().toISOString(),
      payment: status === 'completed' ? {
        methodId: 'paypal',
        providerReference: extra.captureId || orderId
      } : order.payment
    }));
  }

  return nextAttempt;
}

async function markZbdAttemptStatus(internalId, status, extra = {}) {
  if (!internalId) {
    return null;
  }

  let decoded = null;
  try {
    decoded = typeof internalId === 'string' ? JSON.parse(internalId) : internalId;
  } catch {
    decoded = { attemptId: String(internalId) };
  }

  const attempt = await getBy('paymentAttempts', (item) => {
    if (decoded.attemptId && item.id === decoded.attemptId) return true;
    if (decoded.checkoutSessionId && item.checkoutSessionId === decoded.checkoutSessionId && item.methodId === 'zbd') return true;
    if (decoded.orderId && item.orderId === decoded.orderId && item.methodId === 'zbd') return true;
    return false;
  });

  if (!attempt) {
    return null;
  }

  const nextAttempt = await updateBy('paymentAttempts', (item) => item.id === attempt.id, (item) => ({
    ...item,
    status,
    transaction: status === 'completed' ? {
      txid: extra.txid || item.transaction?.txid || item.providerReference || null,
      conf: null,
      address: item.instructions?.address || null,
      amount: item.instructions?.amount || null,
      currency: item.instructions?.currency || null,
      memo: item.instructions?.memo || null
    } : item.transaction,
    updatedAt: new Date().toISOString()
  }));

  if (attempt.checkoutSessionId) {
    const session = await getHostedCheckoutSession(attempt.checkoutSessionId);
    if (session) {
      const sessionStatus = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Pending';
      const updatedSession = await markHostedCheckoutSessionStatus(session.id, sessionStatus, {
        methodId: 'zbd',
        providerReference: extra.txid || nextAttempt.providerReference,
        instructions: nextAttempt.instructions,
        transaction: nextAttempt.transaction
      });

      const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
      if (sessionStatus === 'Completed') {
        await sendMerchantWebhook(updatedSession, 'Completed', 'checkout.completed', { payment: updatedSession.payment });
      } else if (sessionStatus === 'Failed') {
        await sendMerchantWebhook(updatedSession, 'Failed', 'checkout.failed', { payment: updatedSession.payment });
      }
    }
  }

  if (attempt.orderId) {
    await updateBy('orders', (order) => order.id === attempt.orderId, (order) => ({
      ...order,
      status: status === 'completed' ? 'paid' : status === 'failed' ? 'failed' : order.status,
      paidAt: status === 'completed' ? new Date().toISOString() : order.paidAt,
      updatedAt: new Date().toISOString(),
      payment: status === 'completed' ? {
        methodId: 'zbd',
        providerReference: extra.txid || nextAttempt.providerReference
      } : order.payment
    }));
  }

  return nextAttempt;
}

app.post('/webhooks/stripe/:hookId', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const store = await getStoreByHookId(req.params.hookId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const signature = req.headers['stripe-signature'];
    const config = decryptStoreConfig(store);
    let event = JSON.parse(req.body.toString());

    if (config.secrets.stripeWebhookSecret && signature) {
      const stripe = require('stripe')(config.secrets.stripeSecretKey);
      event = stripe.webhooks.constructEvent(req.body, signature, config.secrets.stripeWebhookSecret);
    }

    if (event.type === 'checkout.session.completed') {
      const orderId = event.data.object.metadata?.orderId;
      const checkoutSessionId = event.data.object.metadata?.checkoutSessionId;
      await updateBy('orders', (order) => order.id === orderId, (order) => ({
        ...order,
        status: 'paid',
        paidAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payment: {
          methodId: 'stripe',
          providerReference: event.data.object.id
        }
      }));

      if (checkoutSessionId) {
        const updatedSession = await markHostedCheckoutSessionStatus(checkoutSessionId, 'Completed', {
          methodId: 'stripe',
          providerReference: event.data.object.id
        });
        const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
        await sendMerchantWebhook(updatedSession, 'Completed', 'checkout.completed', { payment: updatedSession.payment });
      }
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/webhooks/nowpayments/:hookId', express.json(), async (req, res) => {
  try {
    const store = await getStoreByHookId(req.params.hookId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (!verifyNowPaymentsSignature(store, req.body, req.headers['x-nowpayments-sig'])) {
      return res.status(400).json({ error: 'Invalid NOWPayments signature' });
    }

    if (['finished', 'confirmed', 'sending', 'partially_paid'].includes(req.body.payment_status)) {
      await updateBy('orders', (order) => order.id === req.body.order_id, (order) => ({
        ...order,
        status: 'paid',
        paidAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payment: {
          methodId: 'nowpayments',
          providerReference: String(req.body.payment_id)
        }
      }));

      const hostedSession = await getHostedCheckoutSession(req.body.order_id);
      if (hostedSession) {
        const updatedSession = await markHostedCheckoutSessionStatus(hostedSession.id, 'Completed', {
          methodId: 'nowpayments',
          providerReference: String(req.body.payment_id)
        });
        const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
        await sendMerchantWebhook(updatedSession, 'Completed', 'checkout.completed', { payment: updatedSession.payment });
      }
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/webhooks/paypal/:hookId', express.json(), async (req, res) => {
  try {
    const store = await getStoreByHookId(req.params.hookId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const verified = await verifyPaypalWebhook(store, req);
    if (!verified) {
      return res.status(400).json({ error: 'Invalid PayPal signature' });
    }

    const event = req.body;
    const eventType = event?.event_type;
    const orderId = getPaypalOrderIdFromEvent(event);

    if (eventType === 'CHECKOUT.ORDER.APPROVED' && orderId) {
      const capture = await capturePaypalOrder(store, orderId);
      const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
      await markPaypalAttemptStatus(orderId, 'pending', { captureId });
    }

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && orderId) {
      await markPaypalAttemptStatus(orderId, 'completed', { captureId: event?.resource?.id || null });
    }

    if (eventType === 'PAYMENT.CAPTURE.PENDING' && orderId) {
      await markPaypalAttemptStatus(orderId, 'pending', { captureId: event?.resource?.id || null });
    }

    if (['PAYMENT.CAPTURE.DENIED', 'CHECKOUT.PAYMENT-APPROVAL.REVERSED'].includes(eventType) && orderId) {
      await markPaypalAttemptStatus(orderId, 'failed', { captureId: event?.resource?.id || null });
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/webhooks/zbd/:hookId', express.json(), async (req, res) => {
  try {
    const store = await getStoreByHookId(req.params.hookId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const payload = req.body || {};
    const normalizedStatus = String(payload.status || payload.payment_status || '').toLowerCase();
    const internalId = payload.internalId || payload.internal_id || payload.metadata?.internalId || null;
    const txid = payload.id || payload.paymentId || payload.payment_id || null;

    if (['completed', 'paid', 'settled'].includes(normalizedStatus)) {
      await markZbdAttemptStatus(internalId, 'completed', { txid });
      return res.json({ received: true });
    }

    if (['failed', 'expired', 'cancelled'].includes(normalizedStatus)) {
      await markZbdAttemptStatus(internalId, 'failed', { txid });
      return res.json({ received: true });
    }

    await markZbdAttemptStatus(internalId, 'pending', { txid });
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.json());
app.use(express.static(publicDir));

app.get('/api/bootstrap', async (req, res) => {
  const myStores = req.user ? await getStoresByOwner(req.user.id) : [];
  res.json({
    platformName,
    supportedCurrencies,
    supportedTokens,
    authUser: normalizeUser(req.user),
    defaultProducts,
    myStore: myStores[0] || null,
    myStores
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await createUser(req.body);
    const store = await createStoreForUser(user, {
      name: `${user.name}'s Store`,
      slug: req.body.slug || req.body.name
    });

    res.status(201).json({
      message: 'Account created. Verify your email before logging in.',
      user: normalizeUser(user),
      store
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { user, token } = await loginUser(req.body.email, req.body.password);
    setSessionCookie(res, token);
    res.json({ user: normalizeUser(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await logoutToken(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const stores = req.user ? await getStoresByOwner(req.user.id) : [];
  res.json({
    user: normalizeUser(req.user),
    store: stores[0] || null,
    stores
  });
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    await verifyEmailToken(req.body.token);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/verify/resend', async (req, res) => {
  try {
    const user = await getBy('users', (item) => item.email === String(req.body.email || '').toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await createVerificationToken(user);
    res.json({
      ok: true,
      previewUrl: result.emailResult.previewUrl || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
  const stores = await getStoresByOwner(req.user.id);
  if (!stores.length) {
    return res.json({
      store: null,
      stores: [],
      stats: {
        totalCheckouts: 0,
        totalOrders: 0,
        paidOrders: 0,
        revenue: 0,
        openIssues: 0
      },
      recentCheckouts: [],
      recentOrders: [],
      issues: []
    });
  }
  const selectedStoreId = req.query.storeId || stores[0].id;
  const store = stores.find((item) => item.id === selectedStoreId);
  if (!store) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const orders = (await list('orders')).filter((order) => order.storeId === store.id);
  const checkoutSessions = (await list('checkoutSessions')).filter((session) => session.storeId === store.id);
  const paymentAttempts = (await list('paymentAttempts')).filter((attempt) => attempt.storeId === store.id);
  const issues = (await list('issues')).filter((issue) => issue.storeId === store.id);
  const paidRevenue = orders
    .filter((order) => order.status === 'paid')
    .reduce((sum, order) => sum + Number(order.totals.total || 0), 0);

  res.json({
    store: sanitizeStore(store),
    stores,
    stats: {
      totalCheckouts: checkoutSessions.length,
      totalOrders: orders.length,
      paidOrders: orders.filter((order) => order.status === 'paid').length,
      revenue: Number(paidRevenue.toFixed(2)),
      openIssues: issues.filter((issue) => issue.status === 'open').length
    },
    recentCheckouts: checkoutSessions
      .slice(-10)
      .reverse()
      .map((session) => ({
        ...session,
        paymentAttempt: paymentAttempts.find((attempt) => attempt.checkoutSessionId === session.id) || null
      })),
    recentOrders: orders.slice(-10).reverse(),
    issues: issues.slice(-10).reverse()
  });
});

app.get('/api/stores', requireAuth, async (req, res) => {
  res.json(await listStoresForUser(req.user));
});

app.post('/api/stores', requireAuth, async (req, res) => {
  try {
    let owner = req.user;

    if (req.user.role === 'admin' && req.body.ownerUserId) {
      const targetUser = await getBy('users', (user) => user.id === req.body.ownerUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Owner user not found' });
      }
      owner = targetUser;
    }

    const created = await createStoreForUser(owner, req.body);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/stores/:storeId/api-key/rotate', requireAuth, async (req, res) => {
  try {
    const rotated = await rotateStoreApiKey(req.params.storeId, req.user.id, req.user.role === 'admin');
    res.json(rotated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/stores/:storeId/checkout-sessions', requireAuth, async (req, res) => {
  const store = await getBy('stores', (item) => item.id === req.params.storeId);
  if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
    return res.status(404).json({ error: 'Store not found' });
  }

  res.json(await listHostedCheckoutSessions(store.id));
});

app.post('/api/stores/:storeId/checkout-sessions', requireAuth, async (req, res) => {
  try {
    const store = await getBy('stores', (item) => item.id === req.params.storeId);
    if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const session = await createHostedCheckoutSession(store, req.body);
    res.status(201).json({
      session,
      checkoutUrl: `${req.protocol}://${req.get('host')}/pay/${session.id}`,
      embedUrl: `${req.protocol}://${req.get('host')}/embed/pay/${session.id}`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/merchant/checkout-sessions', async (req, res) => {
  try {
    const store = await getStoreForRequestSecret(req);
    if (!store) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const session = await createHostedCheckoutSession(store, req.body);
    res.status(201).json({
      session,
      sessionId: session.id,
      checkoutUrl: `${req.protocol}://${req.get('host')}/pay/${session.id}`,
      embedUrl: `${req.protocol}://${req.get('host')}/embed/pay/${session.id}`,
      status: session.status,
      allowedMethods: session.allowedMethods
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/stores/current', requireAuth, async (req, res) => {
  const storeId = req.query.storeId;
  const stores = await getStoresByOwner(req.user.id);
  const store = storeId ? stores.find((item) => item.id === storeId) : stores[0];
  if (!store) {
    return res.status(404).json({ error: 'Store not found' });
  }

  res.json({
    ...sanitizeStore(store),
    configPreview: {
      stripeConfigured: Boolean(store.gatewayState?.stripe),
      paypalConfigured: Boolean(store.gatewayState?.paypal),
      nowpaymentsConfigured: Boolean(store.gatewayState?.nowpayments)
    }
  });
});

app.patch('/api/stores/:storeId', requireAuth, async (req, res) => {
  try {
    const updated = await updateStore(req.params.storeId, req.user.id, {
      ...req.body,
      __adminOverride: req.user.role === 'admin'
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/stores/:storeId/orders', requireAuth, async (req, res) => {
  const store = await getBy('stores', (item) => item.id === req.params.storeId);
  if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const orders = (await list('orders')).filter((order) => order.storeId === store.id).reverse();
  res.json(orders);
});

app.get('/api/stores/:storeId/payment-attempts', requireAuth, async (req, res) => {
  const store = await getBy('stores', (item) => item.id === req.params.storeId);
  if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const attempts = (await list('paymentAttempts')).filter((attempt) => attempt.storeId === store.id).reverse();
  res.json(attempts);
});

app.get('/api/stores/:storeId/issues', requireAuth, async (req, res) => {
  const store = await getBy('stores', (item) => item.id === req.params.storeId);
  if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const issues = (await list('issues')).filter((issue) => issue.storeId === store.id).reverse();
  res.json(issues);
});

app.post('/api/stores/:storeId/issues', requireAuth, async (req, res) => {
  try {
    const store = await getBy('stores', (item) => item.id === req.params.storeId);
    if (!store || (req.user.role !== 'admin' && store.ownerUserId !== req.user.id)) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const issue = await createIssue(store.id, req.user, req.body);
    res.status(201).json(issue);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/summary', requireAdmin, async (_req, res) => {
  const state = await readState();
  res.json({
    stats: {
      users: state.users.length,
      stores: state.stores.length,
      orders: state.orders.length,
      payments: state.paymentAttempts.length,
      openIssues: state.issues.filter((issue) => issue.status === 'open').length
    },
    users: state.users.map(normalizeUser),
    stores: state.stores.map(sanitizeStore),
    orders: state.orders.slice(-25).reverse(),
    issues: state.issues.slice(-25).reverse()
  });
});

app.patch('/api/admin/users/:userId', requireAdmin, async (req, res) => {
  const updated = await updateBy('users', (user) => user.id === req.params.userId, (user) => ({
    ...user,
    status: req.body.status || user.status,
    updatedAt: new Date().toISOString()
  }));

  if (!updated) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(normalizeUser(updated));
});

app.patch('/api/admin/issues/:issueId', requireAdmin, async (req, res) => {
  const updated = await updateBy('issues', (issue) => issue.id === req.params.issueId, (issue) => ({
    ...issue,
    status: req.body.status || issue.status
  }));

  if (!updated) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  res.json(updated);
});

app.get('/api/public/stores/:slug', async (req, res) => {
  const store = await getStoreBySlug(req.params.slug);
  if (!store || store.status !== 'active') {
    return res.status(404).json({ error: 'Store not found' });
  }

  const displayCurrency = String(req.query.currency || store.defaultCurrency).toUpperCase();
  const products = await Promise.all(
    (store.products || []).map(async (product) => ({
      ...product,
      displayPrice: await convertAmount(product.price, store.defaultCurrency, displayCurrency)
    }))
  );

  res.json({
    store: sanitizeStore(store),
    displayCurrency,
    products
  });
});

app.get('/api/public/checkout-sessions/:sessionId', async (req, res) => {
  const session = await getHostedCheckoutSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Checkout session not found' });
  }

  const store = await getBy('stores', (item) => item.id === session.storeId);
  res.json({
    session,
    store: sanitizeStore(store)
  });
});

app.post('/api/public/checkout-sessions/:sessionId/payment', async (req, res) => {
  try {
    const session = await getHostedCheckoutSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }
    const store = await getBy('stores', (item) => item.id === session.storeId);
    const attempt = await createHostedCheckoutPayment(store, session, req.body.methodId, req);
    res.json(attempt);
  } catch (error) {
    const session = await getHostedCheckoutSession(req.params.sessionId);
    if (session) {
      const failed = await markHostedCheckoutSessionStatus(session.id, 'Failed', session.payment || null);
      const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
      await sendMerchantWebhook(failed, 'Failed', 'checkout.failed', { payment: failed.payment });
    }
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/public/checkout-sessions/:sessionId/status', async (req, res) => {
  try {
    const session = await getHostedCheckoutSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }
    const attempt = await getBy('paymentAttempts', (item) => item.checkoutSessionId === session.id);
    res.json({
      ...session,
      paymentAttempt: attempt || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/public/checkout-sessions/:sessionId/cancel', async (req, res) => {
  try {
    const session = await getHostedCheckoutSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }
    const updated = await markHostedCheckoutSessionStatus(session.id, 'Cancelled', session.payment || null);
    const { sendMerchantWebhook } = require('./src/services/outbound-webhooks');
    await sendMerchantWebhook(updated, 'Cancelled', 'checkout.cancelled', { payment: updated.payment });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/public/stores/:slug/orders', async (req, res) => {
  try {
    const store = await getStoreBySlug(req.params.slug);
    if (!store || store.status !== 'active') {
      return res.status(404).json({ error: 'Store not found' });
    }

    const order = await createPublicOrder(store, req.body);
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/public/orders/:orderId/payment', async (req, res) => {
  try {
    const order = await getBy('orders', (item) => item.id === req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const store = await getBy('stores', (item) => item.id === order.storeId);
    const attempt = await createPaymentAttempt(store, order, req.body.methodId, req);
    res.json(attempt);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/public/orders/:orderId/status', async (req, res) => {
  try {
    const order = await getBy('orders', (item) => item.id === req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const refreshed = await getBy('orders', (item) => item.id === order.id);
    const refreshedAttempt = await getBy('paymentAttempts', (item) => item.orderId === order.id);
    res.json({
      ...refreshed,
      paymentAttempt: refreshedAttempt || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/dev/seed-order', async (_req, res) => {
  const stores = await list('stores');
  const store = stores[0];
  if (!store) {
    return res.status(404).json({ error: 'No stores available' });
  }

  const order = await createPublicOrder(store, {
    email: 'buyer@example.com',
    fullName: 'Example Buyer',
    postalCode: 'N1 1AA',
    items: [{ productId: store.products[0]?.id, quantity: 1 }],
    displayCurrency: store.defaultCurrency
  });

  res.json(order);
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

let server = null;
let keepAliveTimer = null;

seedAdminIfNeeded().then(() => {
  server = app.listen(port, () => {
    console.log(`NekoPay listening on http://localhost:${port}`);
  });
  startBackgroundWorker();
  keepAliveTimer = setInterval(() => {}, 60 * 60 * 1000);

  server.on('close', () => {
    console.log('NekoPay server closed');
    stopBackgroundWorker();
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on('SIGINT', () => {
  if (!server) {
    closeStorage().finally(() => process.exit(0));
    return;
  }

  server.close(() => {
    closeStorage().finally(() => process.exit(0));
  });
});

process.on('SIGTERM', () => {
  if (!server) {
    closeStorage().finally(() => process.exit(0));
    return;
  }

  server.close(() => {
    closeStorage().finally(() => process.exit(0));
  });
});
