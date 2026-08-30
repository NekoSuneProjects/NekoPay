'use strict';

require('dotenv').config();

// TRON support is staged but intentionally disabled for now. The current verifier uses
// TronGrid, whose production-friendly access relies on an API key. Keep the implementation
// available for later, but do not expose TRX/TRC-20 methods until a reliable keyless backend
// is selected.
const { supportedTokens } = require('./src/config/platform');
for (const tokenId of ['trx', 'usdt_trx', 'tusd_trx']) {
  if (supportedTokens[tokenId]) supportedTokens[tokenId].enabled = false;
}

// Keep server.js focused on the existing merchant application. This bootstrap mounts
// creator/platform and network-management routers before server.js registers its normal
// routes, then starts the existing merchant server. NekoPay stays one process with two modes.
const express = require('express');
const { createCreatorRouter } = require('./src/routes/creator-api');
const { createNetworkRouter } = require('./src/routes/network-api');
const { startNekoLiveWebhookRecovery } = require('./src/services/nekolive-webhook-recovery');

const bootstrapRouters = [createCreatorRouter(), createNetworkRouter()];
const originalUse = express.application.use;
let mounted = false;

express.application.use = function patchedUse(...args) {
  if (!mounted) {
    mounted = true;
    for (const router of bootstrapRouters) originalUse.call(this, router);
  }
  return originalUse.apply(this, args);
};

require('./server');
startNekoLiveWebhookRecovery();
