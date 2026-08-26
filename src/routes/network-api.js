'use strict';

const express = require('express');
const network = require('../network');

function configuredServiceKey() {
  return process.env.NEKOPAY_SERVICE_API_KEY || process.env.NEKOLIVE_SERVICE_API_KEY || '';
}

function requireNetworkService(req, res, next) {
  const expected = configuredServiceKey();
  if (!expected) return res.status(503).json({ error: 'NekoPay service API key is not configured' });
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const supplied = bearer || String(req.headers['x-nekopay-service-key'] || req.headers['x-nekolive-service-key'] || '');
  if (!supplied || supplied !== expected) return res.status(401).json({ error: 'Invalid NekoPay service key' });
  next();
}

function createNetworkRouter() {
  const router = express.Router();
  router.use('/api/network', requireNetworkService);

  router.get('/api/network/symbols', (_req, res) => {
    res.json({
      verifiedAt: network.verifiedAt,
      symbols: network.symbols().map((symbol) => {
        const config = network.getBackendConfig(symbol);
        return {
          symbol: config.symbol,
          kind: config.kind,
          chainId: config.chainId,
          candidates: config.backends.length
        };
      })
    });
  });

  router.get('/api/network/status/:symbol', async (req, res) => {
    try {
      res.json(await network.getBackendStatus(req.params.symbol, {
        url: req.query.url ? String(req.query.url) : null
      }));
    } catch (error) {
      res.status(Number(error.status || 503)).json({
        error: error.message,
        tried: error.tried || []
      });
    }
  });

  router.get('/api/network/address/:symbol/:address', async (req, res) => {
    try {
      const config = network.getBackendConfig(req.params.symbol);
      if (config.kind === 'evmrpc') {
        const result = await network.read(req.params.symbol, async (client, backend) => ({
          symbol: config.symbol,
          address: req.params.address,
          balanceWei: (await client.balance(req.params.address)).toString(),
          backend: { url: backend.url, operator: backend.operator },
          chainId: await client.chainId(),
          blockNumber: await client.blockNumber()
        }));
        return res.json(result);
      }

      const result = await network.read(req.params.symbol, async (client, backend) => ({
        symbol: config.symbol,
        address: req.params.address,
        data: await client.address(req.params.address, { page: 1, pageSize: 25, details: 'txs' }),
        backend: { url: backend.url, operator: backend.operator }
      }));
      res.json(result);
    } catch (error) {
      res.status(Number(error.status || 503)).json({ error: error.message });
    }
  });

  router.get('/api/network/history/:symbol/:address', async (req, res) => {
    try {
      const explorer = network.getExplorer(req.params.symbol);
      const result = await explorer.transactions(req.params.address, {
        cursor: req.query.cursor ? String(req.query.cursor) : null,
        limit: Math.min(100, Math.max(1, Number(req.query.limit || 50)))
      });
      res.json(result);
    } catch (error) {
      res.status(Number(error.status || 503)).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createNetworkRouter,
  requireNetworkService
};
