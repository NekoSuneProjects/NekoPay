'use strict';

// Keep server.js focused on the existing merchant application. This bootstrap mounts
// the creator/platform integration router before server.js registers its normal routes,
// then starts the unchanged merchant server. That gives NekoPay two modes on one process.
const express = require('express');
const { createCreatorRouter } = require('./src/routes/creator-api');

const creatorRouter = createCreatorRouter();
const originalUse = express.application.use;
let mounted = false;

express.application.use = function patchedUse(...args) {
  if (!mounted) {
    mounted = true;
    originalUse.call(this, creatorRouter);
  }
  return originalUse.apply(this, args);
};

require('./server');
