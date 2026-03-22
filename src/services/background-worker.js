const { append, getBy, list } = require('../lib/app-store');
const { supportedTokens } = require('../config/platform');
const {
  getHostedCheckoutSession,
  refreshHostedCheckoutStatus,
  checkManualPaymentStatus,
  checkNowPaymentsStatus
} = require('./platform');

const PAYMENT_WORKER_INTERVAL_MS = Number(process.env.PAYMENT_WORKER_INTERVAL_MS || 15000);

let timer = null;
let running = false;

function isHandledByWorker(attempt) {
  if (!attempt) return false;
  if (!['pending', 'awaiting_transfer'].includes(String(attempt.status || '').toLowerCase())) {
    return false;
  }
  if (attempt.rateLimitedUntil && new Date(attempt.rateLimitedUntil).getTime() > Date.now()) {
    return false;
  }

  if (attempt.methodId === 'stripe') return true;
  if (attempt.methodId === 'paypal') return true;
  if (attempt.methodId === 'nowpayments') return true;
  if (attempt.methodId === 'zbd') return true;
  if (supportedTokens[attempt.methodId] && supportedTokens[attempt.methodId].enabled !== false) return true;
  return false;
}

async function logWorkerEvent(type, payload) {
  await append('events', {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: new Date().toISOString()
  });
}

async function processAttempt(attempt) {
  const store = await getBy('stores', (item) => item.id === attempt.storeId);
  if (!store) {
    return;
  }

  if (attempt.methodId === 'zbd' && attempt.expiresAt && new Date(attempt.expiresAt).getTime() <= Date.now()) {
    if (attempt.checkoutSessionId) {
      const session = await getHostedCheckoutSession(attempt.checkoutSessionId);
      if (session && !['Completed', 'Failed', 'Cancelled'].includes(session.status)) {
        await refreshHostedCheckoutStatus(store, session);
      }
    }

    if (attempt.orderId) {
      const order = await getBy('orders', (item) => item.id === attempt.orderId);
      if (order && !['paid', 'failed', 'cancelled'].includes(String(order.status || '').toLowerCase())) {
        await checkManualPaymentStatus(store, order, attempt);
      }
    }
  }

  if (attempt.checkoutSessionId) {
    const session = await getHostedCheckoutSession(attempt.checkoutSessionId);
    if (!session || ['Completed', 'Failed', 'Cancelled'].includes(session.status)) {
      return;
    }
    const beforeStatus = session.status;
    const refreshed = await refreshHostedCheckoutStatus(store, session);
    if (refreshed?.status && refreshed.status !== beforeStatus) {
      await logWorkerEvent('background.checkout.status_changed', {
        checkoutSessionId: session.id,
        from: beforeStatus,
        to: refreshed.status,
        methodId: attempt.methodId,
        paymentAttemptId: attempt.id
      });
    }
    return;
  }

  if (attempt.orderId) {
    const order = await getBy('orders', (item) => item.id === attempt.orderId);
    if (!order || ['paid', 'failed', 'cancelled'].includes(String(order.status || '').toLowerCase())) {
      return;
    }

    if (attempt.methodId === 'nowpayments') {
      const beforeStatus = order.status;
      await checkNowPaymentsStatus(store, order, attempt);
      const refreshed = await getBy('orders', (item) => item.id === order.id);
      if (refreshed?.status && refreshed.status !== beforeStatus) {
        await logWorkerEvent('background.order.status_changed', {
          orderId: order.id,
          from: beforeStatus,
          to: refreshed.status,
          methodId: attempt.methodId,
          paymentAttemptId: attempt.id
        });
      }
      return;
    }

    if (supportedTokens[attempt.methodId] && supportedTokens[attempt.methodId].enabled !== false) {
      const beforeStatus = order.status;
      await checkManualPaymentStatus(store, order, attempt);
      const refreshed = await getBy('orders', (item) => item.id === order.id);
      if (refreshed?.status && refreshed.status !== beforeStatus) {
        await logWorkerEvent('background.order.status_changed', {
          orderId: order.id,
          from: beforeStatus,
          to: refreshed.status,
          methodId: attempt.methodId,
          paymentAttemptId: attempt.id
        });
      }
    }
  }
}

async function runPaymentWorker() {
  if (running) {
    return;
  }

  running = true;
  try {
    const attempts = (await list('paymentAttempts')).filter(isHandledByWorker);
    for (const attempt of attempts) {
      try {
        await processAttempt(attempt);
      } catch (error) {
        await logWorkerEvent('background.worker.error', {
          paymentAttemptId: attempt.id,
          methodId: attempt.methodId,
          message: error.message
        });
      }
    }
  } finally {
    running = false;
  }
}

function startBackgroundWorker() {
  if (timer) {
    return;
  }

  timer = setInterval(() => {
    runPaymentWorker().catch(() => {});
  }, PAYMENT_WORKER_INTERVAL_MS);

  runPaymentWorker().catch(() => {});
}

function stopBackgroundWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startBackgroundWorker,
  stopBackgroundWorker,
  runPaymentWorker
};
