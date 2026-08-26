'use strict';

const { list } = require('../lib/app-store');
const { sendMerchantWebhook } = require('./outbound-webhooks');

const DEFAULT_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.NEKOLIVE_WEBHOOK_RECOVERY_INTERVAL_MS || 60000)
);

let recoveryTimer = null;
let recoveryRunning = false;

function isNekoLiveCreatorCheckout(session) {
  return String(session?.metadata?.platform || '').toLowerCase() === 'nekolive'
    && Boolean(session?.notificationUrl);
}

function successfulCompletedDeliveries(events) {
  return new Set(
    events
      .filter((event) => event?.type === 'webhook.checkout.completed' && event?.checkoutSessionId)
      .map((event) => String(event.checkoutSessionId))
  );
}

async function recoverMissedNekoLiveWebhooks() {
  if (recoveryRunning) return { skipped: true, reason: 'already_running' };
  recoveryRunning = true;
  try {
    const [sessions, events] = await Promise.all([
      list('checkoutSessions'),
      list('events')
    ]);
    const delivered = successfulCompletedDeliveries(events);
    const missing = sessions
      .filter((session) => String(session?.status || '').toLowerCase() === 'completed')
      .filter(isNekoLiveCreatorCheckout)
      .filter((session) => !delivered.has(String(session.id)))
      .sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0))
      .slice(0, 50);

    let recovered = 0;
    let failed = 0;
    for (const session of missing) {
      const result = await sendMerchantWebhook(
        session,
        'Completed',
        'checkout.completed',
        { payment: session.payment || null }
      );
      if (result?.delivered) recovered += 1;
      else failed += 1;
    }

    if (missing.length) {
      console.log(
        `[nekolive-webhook-recovery] checked ${missing.length} completed creator checkout(s): ${recovered} recovered, ${failed} still pending.`
      );
    }

    return { checked: missing.length, recovered, failed };
  } catch (error) {
    console.error('[nekolive-webhook-recovery] recovery pass failed:', error);
    return { error: error.message };
  } finally {
    recoveryRunning = false;
  }
}

function startNekoLiveWebhookRecovery() {
  if (recoveryTimer) return recoveryTimer;

  // Run once shortly after startup so completed crypto checkouts from an older
  // process/version are repaired without waiting for a new browser status poll.
  setTimeout(() => {
    recoverMissedNekoLiveWebhooks().catch((error) => {
      console.error('[nekolive-webhook-recovery] startup pass failed:', error);
    });
  }, 3000).unref?.();

  recoveryTimer = setInterval(() => {
    recoverMissedNekoLiveWebhooks().catch((error) => {
      console.error('[nekolive-webhook-recovery] scheduled pass failed:', error);
    });
  }, DEFAULT_INTERVAL_MS);
  recoveryTimer.unref?.();
  return recoveryTimer;
}

module.exports = {
  recoverMissedNekoLiveWebhooks,
  startNekoLiveWebhookRecovery
};
