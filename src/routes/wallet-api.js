'use strict';

const express = require('express');
const QRCode = require('qrcode');

function createWalletRouter() {
  const router = express.Router();

  // Render payment URIs locally so checkout QR codes do not leak invoice details to
  // third-party QR services. The browser sends only the payment URI to this NekoPay server.
  router.get('/api/public/wallet/qr', async (req, res) => {
    try {
      const data = String(req.query.data || '').trim();
      if (!data) return res.status(400).json({ error: 'QR data is required' });
      if (data.length > 4096) return res.status(400).json({ error: 'QR data is too long' });

      const png = await QRCode.toBuffer(data, {
        type: 'png',
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M'
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.send(png);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not build wallet QR code' });
    }
  });

  return router;
}

module.exports = { createWalletRouter };
