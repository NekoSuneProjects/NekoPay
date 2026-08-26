'use strict';

// Importing NekoPay must never start the hosted web application. The server is started
// only by `npm start` -> creator-bootstrap.js. This SDK surface replaces the old
// nekosunevr-payments module for NekoLive while also exposing the service client.
const chainModules = require('./src/compat/chain-modules');
const { NekoPayClient } = require('./src/client');

module.exports = {
  ...chainModules,
  NekoPayClient
};
