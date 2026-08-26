'use strict';

require('dotenv').config();

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
