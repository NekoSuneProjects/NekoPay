'use strict';

const COOLDOWN_MS = Number(process.env.NEKOPAY_BACKEND_COOLDOWN_MS || 300000);
const PROBE_LIMIT = Number(process.env.NEKOPAY_BACKEND_PROBE_LIMIT || 8);

function isTransportFailure(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || error?.response?.status || 0);
  if ([429, 502, 503, 504].includes(status)) return true;
  return /network error|timed out|timeout|abort|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|non-JSON|HTTP 5\d\d|HTTP 429/i.test(message);
}

class BackendPool {
  constructor({ label, build, verify, missing }) {
    this.label = label;
    this.build = build;
    this.verify = verify;
    this.missing = missing;
    this.candidates = [];
    this.pinned = null;
    this.active = null;
    this.state = new Map();
  }

  setCandidates(list) {
    this.candidates = (list || [])
      .filter((entry) => entry?.url)
      .map((entry) => ({
        url: String(entry.url).trim().replace(/\/+$/, ''),
        operator: entry.operator || 'unknown',
        note: entry.note || '',
        kind: entry.kind || null
      }));
    return this;
  }

  pin(url) {
    const clean = url ? String(url).trim().replace(/\/+$/, '') : null;
    if (clean !== this.pinned) {
      this.pinned = clean;
      this.active = null;
    }
    return this;
  }

  _queue({ includeCooling = false } = {}) {
    const seen = new Set();
    const output = [];
    const push = (candidate) => {
      if (!candidate?.url || seen.has(candidate.url)) return;
      seen.add(candidate.url);
      const state = this.state.get(candidate.url);
      const cooling = state && !state.ok && Date.now() - state.at < COOLDOWN_MS;
      if (cooling && !includeCooling) return;
      output.push(candidate);
    };

    if (this.pinned) {
      push({ url: this.pinned, operator: 'configured', note: 'explicitly configured endpoint' });
      return output;
    }

    this.candidates.forEach(push);
    return output;
  }

  async resolve() {
    if (this.active) return this.active;

    let queue = this._queue();
    if (!queue.length) queue = this._queue({ includeCooling: true });
    if (!queue.length) {
      throw Object.assign(new Error(this.missing || `No ${this.label} backend is configured`), { status: 503 });
    }

    const tried = [];
    for (const candidate of queue.slice(0, PROBE_LIMIT)) {
      try {
        const client = this.build(candidate.url);
        const info = await this.verify(client);
        this.state.set(candidate.url, { ok: true, error: null, at: Date.now() });
        this.active = {
          ...candidate,
          client,
          info,
          at: Date.now()
        };
        return this.active;
      } catch (error) {
        this.state.set(candidate.url, { ok: false, error: error.message, at: Date.now() });
        tried.push(`${candidate.url} (${error.message})`);
      }
    }

    throw Object.assign(
      new Error(`No working ${this.label} backend found.${tried.length ? ` Tried: ${tried.join('; ')}` : ''}`),
      { status: 503, tried }
    );
  }

  async rotate(reason = 'failed') {
    const previous = this.active;
    if (previous) this.state.set(previous.url, { ok: false, error: reason, at: Date.now() });
    this.active = null;
    if (this.pinned && (!previous || previous.url === this.pinned)) this.pinned = null;
    const next = await this.resolve();
    return { from: previous?.url || null, to: next.url, reason };
  }

  async read(worker) {
    const first = await this.resolve();
    try {
      return await worker(first.client, first);
    } catch (error) {
      if (!isTransportFailure(error) || this.pinned) throw error;
      let rotation;
      try {
        rotation = await this.rotate(error.message);
      } catch (_) {
        throw error;
      }
      const next = await this.resolve();
      const output = await worker(next.client, next);
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        output.backendRotated = rotation;
      }
      return output;
    }
  }

  // Broadcasts deliberately do not retry on another backend. If the first node accepted
  // the transaction but the response was lost, retrying somewhere else can create unsafe
  // duplicate-send/nonce behaviour.
  async broadcast(worker) {
    const active = await this.resolve();
    return worker(active.client, active);
  }

  health() {
    const rows = [];
    const candidates = this.pinned
      ? [{ url: this.pinned, operator: 'configured', note: 'explicitly configured endpoint', pinned: true }, ...this.candidates]
      : this.candidates;

    for (const candidate of candidates) {
      if (!candidate?.url) continue;
      const state = this.state.get(candidate.url);
      rows.push({
        url: candidate.url,
        operator: candidate.operator || 'unknown',
        note: candidate.note || '',
        pinned: Boolean(candidate.pinned || candidate.url === this.pinned),
        state: this.active?.url === candidate.url ? 'active' : !state ? 'untried' : state.ok ? 'ok' : 'failed',
        error: state && !state.ok ? state.error : null,
        checkedAt: state?.at || null,
        coolingUntil: state && !state.ok ? state.at + COOLDOWN_MS : null
      });
    }
    return rows;
  }

  summary() {
    return {
      label: this.label,
      url: this.active?.url || this.pinned || null,
      operator: this.active?.operator || (this.pinned ? 'configured' : null),
      pinned: Boolean(this.pinned),
      auto: !this.pinned,
      probed: Boolean(this.active),
      candidates: this.candidates.length,
      info: this.active?.info || null
    };
  }
}

module.exports = {
  BackendPool,
  isTransportFailure,
  COOLDOWN_MS,
  PROBE_LIMIT
};
