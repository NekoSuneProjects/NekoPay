const axios = require('axios');
const { append } = require('../lib/app-store');
const { appBaseUrl } = require('../config/platform');

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

  try {
    const response = await axios.post(session.notificationUrl, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });

    await append('events', {
      id: `evt_${Date.now()}`,
      type: `webhook.${event}`,
      checkoutSessionId: session.id,
      targetUrl: session.notificationUrl,
      statusCode: response.status,
      payload,
      createdAt: new Date().toISOString()
    });

    return { delivered: true, statusCode: response.status };
  } catch (error) {
    await append('events', {
      id: `evt_${Date.now()}`,
      type: `webhook.${event}.failed`,
      checkoutSessionId: session.id,
      targetUrl: session.notificationUrl,
      error: error.message,
      payload,
      createdAt: new Date().toISOString()
    });
    return { delivered: false, error: error.message };
  }
}

module.exports = {
  sendMerchantWebhook
};
