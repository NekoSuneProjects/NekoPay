'use strict';

const axios = require('axios');

class NekoPayClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || process.env.NEKOPAY_BASE_URL || 'https://pay.nekolive.co.uk').replace(/\/+$/, '');
    this.serviceApiKey = options.serviceApiKey || process.env.NEKOPAY_SERVICE_API_KEY || process.env.NEKOLIVE_SERVICE_API_KEY || '';
    this.timeout = Number(options.timeout || process.env.NEKOPAY_TIMEOUT_MS || 12000);
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  serviceHeaders() {
    if (!this.serviceApiKey) throw new Error('NekoPay service API key is not configured');
    return {
      Authorization: `Bearer ${this.serviceApiKey}`,
      'x-nekolive-service-key': this.serviceApiKey
    };
  }

  async request(method, path, data) {
    try {
      const response = await this.http.request({ method, url: path, data, headers: this.serviceHeaders() });
      return response.data;
    } catch (error) {
      const message = error.response?.data?.error || error.response?.data?.message || error.message;
      const wrapped = new Error(`NekoPay request failed: ${message}`);
      wrapped.status = error.response?.status || 502;
      wrapped.cause = error;
      throw wrapped;
    }
  }

  startCreatorLink(payload) { return this.request('post', '/api/creator/integrations/nekolive/link/start', payload); }
  creatorStatus(creatorId) { return this.request('post', '/api/creator/integrations/nekolive/status', { creatorId }); }
  unlinkCreator(payload) { return this.request('post', '/api/creator/integrations/nekolive/unlink', payload); }
  createCreatorCheckout(payload) { return this.request('post', '/api/creator/checkout-sessions', payload); }
  verifyTransaction(payload) { return this.request('post', '/api/verification/transaction', payload); }
}

module.exports = { NekoPayClient };
