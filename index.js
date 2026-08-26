'use strict';

// Importing NekoPay must never start the hosted web application. The server is started
// only by `npm start` -> creator-bootstrap.js. This SDK surface replaces the old
// nekosunevr-payments module for NekoLive while also exposing the service client.
const chainModules = require('./src/compat/chain-modules');
const antelopeModules = require('./src/compat/antelope-modules');
const networkChainModules = require('./src/compat/network-chain-modules');
const solanaPayModule = require('./src/compat/solana-pay-module');
const network = require('./src/network');
const { NekoPayClient } = require('./src/client');

module.exports = {
  ...chainModules,
  ...antelopeModules,
  ...networkChainModules,
  ...solanaPayModule,
  network,
  NekoPayClient
};
