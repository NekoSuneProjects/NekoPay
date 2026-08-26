const axios = require('axios');
const { append } = require('../lib/app-store');
const { appBaseUrl } = require('../config/platform');

const WEBHOOK_ATTEMPTS = Math.max(1, Number(process.env.MERCHANT_WEBHOOK_ATTEMPTS || 4));
const WEBHOOK_RETRY_BASE_MS = Math.max(250, Number(process.env.MERCHANT_WEBHOOK_RETRY_BASE_MS || 1000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  let lastError = null;
  for (let attempt = 1; attempt <= WEBHOOK_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.post(session.notificationUrl, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'x-nekopay-event': event,
          'x-nekopay-checkout-session': String(session.id || ''),
          'x-nekopay-delivery-attempt': String(attempt),
          ...(session.notificationSecret ? {
            Authorization: `Bearer ${session.notificationSecret}`,
            'x-nekopay-webhook-secret': session.notificationSecret
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

      return { delivered: true, statusCode: response.status, attempts: attempt };
    } catch (error) {
      lastError = error;
      const statusCode = Number(error?.response?.status || 0) || null;
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
    attempts: WEBHOOK_ATTEMPTS,
    payload,
    createdAt: new Date().toISOString()
  });
  console.error(
    `[merchant-webhook] Failed ${event} delivery to ${session.notificationUrl} after ${WEBHOOK_ATTEMPTS} attempt(s):`,
    lastError?.message || 'unknown error'
  );
  return { delivered: false, error: lastError?.message || 'Webhook delivery failed', attempts: WEBHOOK_ATTEMPTS };
}

module.exports = {
  sendMerchantWebhook
};
