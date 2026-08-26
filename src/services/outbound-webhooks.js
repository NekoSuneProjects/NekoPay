const axios = require('axios');
const { append } = require('../lib/app-store');
const { appBaseUrl } = require('../config/platform');

const WEBHOOK_ATTEMPTS = Math.max(1, Number(process.env.MERCHANT_WEBHOOK_ATTEMPTS || 4));
const WEBHOOK_RETRY_BASE_MS = Math.max(250, Number(process.env.MERCHANT_WEBHOOK_RETRY_BASE_MS || 1000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notificationSecretFor(session) {
  const persisted = String(session?.notificationSecret || '').trim();
  if (persisted) return persisted;

  // Older/current checkout-session rows do not persist notificationSecret.
  // NekoLive creator checkouts are server-to-server integrations, so recover
  // their callback authentication from the shared service secret after the
  // checkout is reloaded from the database. This is especially important for
  // on-chain crypto, where completion is detected later during status polling.
  if (String(session?.metadata?.platform || '').toLowerCase() === 'nekolive') {
    return String(
      process.env.NEKOLIVE_WEBHOOK_SECRET ||
      process.env.NEKOPAY_WEBHOOK_SECRET ||
      process.env.NEKOLIVE_SERVICE_API_KEY ||
      process.env.NEKOPAY_SERVICE_API_KEY ||
      ''
    ).trim();
  }

  return '';
}

async function sendMerchantWebhook(session, status, event, extra = {}) {
  if (!session?.notificationUrl) {
    return { skipped: true };
  }

  const payload = {
    event,
    status,
    checkoutSessionId: session.id,
    storeId: session.storeId,
    hookId: session.hookId,
    externalId: session.externalId || null,
    item: {
      name: session.itemName,
      description: session.itemDescription || '',
      amount: session.amount,
      currency: session.currency
    },
    customer: session.customer || {},
    payment: extra.payment || null,
    metadata: session.metadata || {},
    checkoutUrl: `${appBaseUrl}/pay/${session.id}`,
    createdAt: new Date().toISOString()
  };

  const notificationSecret = notificationSecretFor(session);
  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= WEBHOOK_ATTEMPTS; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await axios.post(session.notificationUrl, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'x-nekopay-event': event,
          'x-nekopay-checkout-session': String(session.id || ''),
          'x-nekopay-delivery-attempt': String(attempt),
          ...(notificationSecret ? {
            Authorization: `Bearer ${notificationSecret}`,
            'x-nekopay-webhook-secret': notificationSecret
          } : {})
        }
      });

      await append('events', {
        id: `evt_${Date.now()}_${attempt}`,
        type: `webhook.${event}`,
        checkoutSessionId: session.id,
        targetUrl: session.notificationUrl,
        statusCode: response.status,
        attempts: attempt,
        payload,
        createdAt: new Date().toISOString()
      });

      console.log(
        `[merchant-webhook] Delivered ${event} for ${session.id} to ${session.notificationUrl} (${response.status}, attempt ${attempt}).`
      );
      return { delivered: true, statusCode: response.status, attempts: attempt };
    } catch (error) {
      lastError = error;
      const statusCode = Number(error?.response?.status || 0) || null;
      const responseText = typeof error?.response?.data === 'string'
        ? error.response.data.slice(0, 500)
        : error?.response?.data
          ? JSON.stringify(error.response.data).slice(0, 500)
          : '';
      console.warn(
        `[merchant-webhook] ${event} delivery attempt ${attempt}/${WEBHOOK_ATTEMPTS} failed for ${session.id}:`,
        statusCode ? `HTTP ${statusCode}` : error.message,
        responseText || ''
      );
      const retryable = !statusCode || statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
      if (!retryable || attempt >= WEBHOOK_ATTEMPTS) break;
      await sleep(WEBHOOK_RETRY_BASE_MS * attempt);
    }
  }

  await append('events', {
    id: `evt_${Date.now()}_failed`,
    type: `webhook.${event}.failed`,
    checkoutSessionId: session.id,
    targetUrl: session.notificationUrl,
    error: lastError?.message || 'Webhook delivery failed',
    statusCode: Number(lastError?.response?.status || 0) || null,
    attempts: attemptsMade,
    payload,
    createdAt: new Date().toISOString()
  });
  console.error(
    `[merchant-webhook] Failed ${event} delivery to ${session.notificationUrl} after ${attemptsMade} attempt(s):`,
    lastError?.message || 'unknown error'
  );
  return { delivered: false, error: lastError?.message || 'Webhook delivery failed', attempts: attemptsMade };
}

module.exports = {
  sendMerchantWebhook,
  notificationSecretFor
};
