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

  router.post('/api/network/verify', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      const symbol = String(req.body.network || req.body.chain || req.body.symbol || '').trim().toUpperCase();
      if (!symbol) return res.status(400).json({ error: 'network/chain is required' });
      const sdk = require('../../index');
      const Module = sdk[`${symbol}Module`];
      if (!Module) return res.status(400).json({ error: `Unsupported verification network: ${symbol}` });

      // Keep user/payment amounts as decimal strings all the way into the verifier. Turning a
      // token amount into a JS Number first can silently lose atomic-unit precision.
      const amount = String(req.body.amount ?? '').trim();
      if (!/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'amount must be greater than zero' });
      }

      const verifier = new Module({
        ...(req.body.backendUrl || req.body.rpcUrl || req.body.explorerUrl
          ? { url: req.body.backendUrl || req.body.rpcUrl || req.body.explorerUrl }
          : {}),
        ...(Array.isArray(req.body.altBackendUrls) ? { altExplorerUrls: req.body.altBackendUrls } : {}),
        ...(req.body.tokenContract ? { tokenContract: req.body.tokenContract } : {}),
        ...(req.body.decimals != null ? { decimals: Number(req.body.decimals) } : {})
      });
      const result = await verifier.existsTransaction(
        req.body.address || req.body.account,
        amount,
        req.body.timestamp,
        req.body.memo || req.body.reference || null,
        Number(req.body.minimumConfirmations || 0)
      );
      res.json({ network: symbol, ...result });
    } catch (error) {
      res.status(Number(error.status || 400)).json({ error: error.message });
    }
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
