const app = document.getElementById('app');
const state = { bootstrap: null, me: null, dashboard: null, admin: null, publicStore: null };
const secretGatewayFields = [
  ['stripeSecretKey', 'Stripe secret key'],
  ['stripeWebhookSecret', 'Stripe webhook secret'],
  ['paypalClientId', 'PayPal client ID'],
  ['paypalClientSecret', 'PayPal client secret'],
  ['paypalWebhookId', 'PayPal webhook ID'],
  ['nowpaymentsApiKey', 'NOWPayments API key'],
  ['nowpaymentsIpnSecret', 'NOWPayments IPN secret'],
  ['zbdApiKey', 'ZBD API key']
];
const walletGatewayFields = [
  ['hiveAddress', 'Hive account'],
  ['hbdAddress', 'HBD account'],
  ['steemAddress', 'Steem account'],
  ['sbdAddress', 'SBD account'],
  ['blurtAddress', 'Blurt account'],
  ['ethAddress', 'ETH address'],
  ['polAddress', 'POL address'],
  ['bnbAddress', 'BNB address'],
  ['tlosAddress', 'Telos account'],
  ['eosAddress', 'EOS account'],
  ['fioPublicKey', 'FIO public key'],
  ['waxAddress', 'WAX account'],
  ['pivxAddress', 'PIVX address'],
  ['flsAddress', 'FLS address'],
  ['zbdReceiverType', 'ZBD receiver type'],
  ['zbdGamertag', 'ZBD gamertag'],
  ['zbdLightningAddress', 'ZBD lightning address']
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function money(value, code = 'USD') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).format(Number(value || 0));
}

function methodLabel(methodId) {
  const token = state.bootstrap?.supportedTokens?.[methodId];
  if (token?.label) return token.label;
  if (String(methodId || '').toLowerCase() === 'zbd') return 'ZBD Lightning';
  return String(methodId || '').toUpperCase();
}

function pathname() {
  return window.location.pathname.split('/').filter(Boolean);
}

function stopStatusPolling(key) {
  if (state[key]) {
    window.clearInterval(state[key]);
    state[key] = null;
  }
}

function startStatusPolling(key, handler, intervalMs = 10000) {
  stopStatusPolling(key);
  state[key] = window.setInterval(handler, intervalMs);
}

function stopDashboardPolling() {
  stopStatusPolling('dashboardSummaryTimer');
}

function formatStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return 'Pending';
  if (normalized === 'paid' || normalized === 'completed') return 'Completed';
  if (normalized === 'failed') return 'Failed';
  if (normalized === 'cancelled') return 'Cancelled';
  if (normalized === 'pending') return 'Pending';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function prettyJson(value) {
  return escapeHtml(JSON.stringify(value || {}, null, 2));
}

function webhookUrl(pathname) {
  return `${window.location.origin}${pathname}`;
}

function renderDashboardStats(stats, currency) {
  return [
    ['Checkouts', stats.totalCheckouts],
    ['Paid', stats.paidOrders],
    ['Revenue', money(stats.revenue, currency)],
    ['Issues', stats.openIssues]
  ].map(([k, v]) => `<div class="glass rounded-[2rem] border border-white/10 p-5"><div class="text-soft">${k}</div><div class="mt-2 text-3xl font-bold text-white">${v}</div></div>`).join('');
}

function renderRecentCheckoutSessions(recentCheckouts) {
  return recentCheckouts.map((session) => `
    <details class="rounded-2xl border border-white/10 p-4">
      <summary class="flex cursor-pointer list-none items-start justify-between gap-4">
        <div>
          <div class="text-white">${escapeHtml(session.itemName || session.id)}</div>
          <div class="mt-1 text-sm text-soft">${session.externalId || session.id} | ${money(session.amount, session.currency)}</div>
        </div>
        <div class="text-right">
          <div class="${formatStatus(session.status) === 'Completed' ? 'text-accent' : formatStatus(session.status) === 'Failed' ? 'text-red-300' : 'text-soft'}">${formatStatus(session.status)}</div>
          <div class="mt-1 text-xs text-soft">${formatDateTime(session.createdAt)}</div>
        </div>
      </summary>
      <div class="mt-4 grid gap-2 text-sm text-soft">
        <div>Session ID: <span class="break-all text-white">${session.id}</span></div>
        <div>Allowed methods: <span class="text-white">${(session.allowedMethods || []).join(', ') || '-'}</span></div>
        <div>Notification URL: <span class="break-all text-white">${session.notificationUrl || '-'}</span></div>
        <div>Success URL: <span class="break-all text-white">${session.successUrl || '-'}</span></div>
        <div>Cancel URL: <span class="break-all text-white">${session.cancelUrl || '-'}</span></div>
        <div>Metadata:</div>
        <pre class="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-xs text-white">${prettyJson(session.metadata)}</pre>
        ${session.paymentAttempt ? `
          <div>Payment method: <span class="text-white">${methodLabel(session.paymentAttempt.methodId || '-')}</span></div>
          <div>Payment status: <span class="text-white">${formatStatus(session.paymentAttempt.status)}</span></div>
          <div>Confirmations: <span class="text-white">${session.paymentAttempt.transaction?.conf ?? 0}${session.paymentAttempt.confirmationTarget != null ? ` / ${session.paymentAttempt.confirmationTarget}` : ''}</span></div>
          <div>Transaction ID: <span class="break-all text-white">${session.paymentAttempt.transaction?.txid || '-'}</span></div>
          <div>Memo: <span class="break-all text-white">${session.paymentAttempt.transaction?.memo || session.paymentAttempt.instructions?.memo || '-'}</span></div>
          ${session.paymentAttempt.rateLimitedUntil ? `<div>Rate limited until: <span class="text-amber-300">${formatDateTime(session.paymentAttempt.rateLimitedUntil)}</span></div>` : ''}
          ${session.paymentAttempt.instructions?.invoiceRequest ? `<div>Invoice: <span class="break-all text-white">${session.paymentAttempt.instructions.invoiceRequest}</span></div>` : ''}
        ` : '<div>No payment attempt yet.</div>'}
      </div>
    </details>
  `).join('') || `<div class="text-soft">No hosted checkout sessions yet.</div>`;
}

function renderPaymentStatus(containerId, {
  title,
  status,
  paymentAttempt,
  fallbackPayment,
  refreshButtonId
}) {
  const container = document.getElementById(containerId);
  const attempt = paymentAttempt || fallbackPayment || {};
  const instructions = attempt.instructions || {};
  const transaction = attempt.transaction || null;
  const statusLabel = formatStatus(status || attempt.status);
  const confirmationTarget = attempt.confirmationTarget;
  const currentConfirmations = transaction?.conf != null ? Number(transaction.conf) : 0;
  const memo = transaction?.memo || instructions.memo || null;
  const txid = transaction?.txid || null;
  const amount = transaction?.amount || instructions.amount || '-';
  const currency = transaction?.currency || instructions.currency || '';
  const address = transaction?.address || instructions.address || '-';
  const invoiceRequest = instructions.invoiceRequest || null;
  const note = instructions.note || null;
  const network = instructions.network || null;
  const contract = transaction?.contract || instructions.contract || null;
  const rateLimitedUntil = attempt.rateLimitedUntil || null;
  const lastErrorCode = attempt.lastErrorCode || null;
  const lastError = attempt.lastError || null;
  const timeoutMessage = attempt.expiresAt
    ? statusLabel === 'Failed'
      ? `Payment expired at ${formatDateTime(attempt.expiresAt)}.`
      : `Payment window ends at ${formatDateTime(attempt.expiresAt)}.`
    : '';

  container.innerHTML = `
    <div class="space-y-1">
      <div class="text-white">${title}</div>
      <div>Pay to: ${address}</div>
      <div>Amount: ${amount} ${currency}</div>
      ${memo ? `<div>Memo: ${memo}</div>` : ''}
      ${network ? `<div>Network: ${network}</div>` : ''}
      ${contract ? `<div>Contract: <span class="break-all">${contract}</span></div>` : ''}
      ${invoiceRequest ? `<div>Invoice: <span class="break-all">${invoiceRequest}</span></div>` : ''}
      ${note ? `<div>Note: ${note}</div>` : ''}
      <div class="pt-2 text-white">Current status: ${statusLabel}</div>
      ${confirmationTarget != null ? `<div>Confirmations: ${currentConfirmations} / ${confirmationTarget}</div>` : ''}
      ${txid ? `<div>Transaction ID: <span class="break-all">${txid}</span></div>` : ''}
      ${rateLimitedUntil ? `<div class="text-amber-300">Chain API rate limited. Retry after ${formatDateTime(rateLimitedUntil)}.${lastErrorCode ? ` Code: ${lastErrorCode}.` : ''}</div>` : ''}
      ${!rateLimitedUntil && lastError ? `<div class="text-amber-300">Last check error: ${lastError}</div>` : ''}
      ${timeoutMessage ? `<div>${timeoutMessage}</div>` : ''}
      <button id="${refreshButtonId}" class="mt-3 rounded-full border border-accent/30 px-4 py-2 text-accent">Refresh status</button>
    </div>
  `;
}

function shell(content, user = state.me?.user) {
  app.innerHTML = `
    <header class="sticky top-0 z-30 border-b border-white/10 bg-black/70 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="/" class="text-xl font-bold text-white">Neko<span class="text-accent">Pay</span></a>
        <nav class="flex items-center gap-3 text-sm text-soft">
          <a href="/" class="hover:text-white">Home</a>
          ${user ? `<a href="/dashboard" class="hover:text-white">Dashboard</a>` : `<a href="/login" class="hover:text-white">Login</a>`}
          ${user?.role === 'admin' ? `<a href="/admin" class="hover:text-white">Admin</a>` : ''}
          ${user ? `<button id="logoutButton" class="rounded-full border border-white/10 px-4 py-2 hover:border-accent/30 hover:text-white">Logout</button>` : `<a href="/register" class="rounded-full bg-accent px-4 py-2 font-semibold text-black">Create store</a>`}
        </nav>
      </div>
    </header>
    <main class="grid-bg min-h-[calc(100vh-72px)]">${content}</main>
  `;

  const logout = document.getElementById('logoutButton');
  if (logout) logout.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

function heroPage() {
  shell(`
    <section class="mx-auto flex max-w-7xl flex-col gap-12 px-6 py-20 lg:flex-row lg:items-center">
      <div class="max-w-3xl">
        <div class="mb-5 inline-flex rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">Merchant Platform</div>
        <h1 class="text-5xl font-bold leading-tight text-white md:text-7xl">Run your own hosted payment gateway with encrypted config and embeddable checkout.</h1>
        <p class="mt-6 max-w-2xl text-lg text-soft">Merchants register, verify email, create stores, save Stripe, PayPal and NOWPayments credentials, map webhook hook IDs, and accept Hive, HBD, Steem, SBD, Blurt, Telos, EOS, FIO, WAX, PIVX, and FLS through hosted checkout sessions from any external site.</p>
        <div class="mt-8 flex flex-wrap gap-4">
          <a href="/register" class="rounded-full bg-accent px-6 py-3 font-semibold text-black shadow-glow">Launch your store</a>
          <a href="/login" class="rounded-full border border-white/10 px-6 py-3 font-semibold text-white">Login</a>
        </div>
      </div>
      <div class="w-full max-w-xl rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0e1610] to-[#070a08] p-6 shadow-glow">
        <div class="text-sm uppercase tracking-[0.3em] text-soft">Why it works</div>
        <div class="mt-5 grid gap-4">
          ${[
            'Per-store hook IDs for webhook routing and account mapping.',
            'Encrypted gateway credentials with secure passwords and cookie sessions.',
            'Customer dashboard, admin dashboard, hosted checkout sessions, and embed routes.'
          ].map((x) => `<div class="rounded-3xl border border-white/10 bg-black/30 p-5 text-white">${x}</div>`).join('')}
        </div>
      </div>
    </section>
  `);
}

function authPage(mode) {
  const isRegister = mode === 'register';
  shell(`
    <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-6xl items-center px-6 py-16">
      <div class="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div class="inline-flex rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">Account Access</div>
          <h1 class="mt-6 text-5xl font-bold text-white">${isRegister ? 'Create your merchant account' : 'Login to your store'}</h1>
          <p class="mt-4 max-w-xl text-soft">Email verification is required before dashboard access.</p>
        </div>
        <form id="authForm" class="glass rounded-[2rem] border border-white/10 p-8 shadow-glow">
          <div class="grid gap-4">
            ${isRegister ? `<input name="name" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Display name" />` : ''}
            <input name="email" type="email" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Email address" />
            <input name="password" type="password" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Password" />
            ${isRegister ? `<input name="slug" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store slug optional" />` : ''}
            <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">${isRegister ? 'Register' : 'Login'}</button>
            <div id="authMessage" class="text-sm text-soft"></div>
          </div>
        </form>
      </div>
    </section>
  `);

  document.getElementById('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      if (isRegister) {
        const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        document.getElementById('authMessage').textContent = result.message;
      } else {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
        window.location.href = '/dashboard';
      }
    } catch (error) {
      document.getElementById('authMessage').textContent = error.message;
    }
  });
}

function verifyPage() {
  shell(`
    <section class="mx-auto flex min-h-[calc(100vh-72px)] max-w-3xl items-center px-6 py-16">
      <div class="glass w-full rounded-[2rem] border border-white/10 p-8 shadow-glow">
        <h1 class="text-4xl font-bold text-white">Verify account</h1>
        <div id="verifyMessage" class="mt-4 text-soft">Confirming your token...</div>
      </div>
    </section>
  `);

  const token = new URLSearchParams(window.location.search).get('token');
  api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
    .then(() => { document.getElementById('verifyMessage').innerHTML = `Email verified. <a class="text-accent" href="/login">Login now</a>.`; })
    .catch((error) => { document.getElementById('verifyMessage').textContent = error.message; });
}

function dashboardShell(title, menu, content) {
  shell(`
    <section class="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">
      <aside class="glass rounded-[2rem] border border-white/10 p-6 shadow-glow">
        <div class="text-sm uppercase tracking-[0.3em] text-soft">${title}</div>
        <div class="mt-3 text-2xl font-bold text-white">${state.me?.user?.name || ''}</div>
        <div class="mt-1 text-soft">${state.me?.user?.email || ''}</div>
        <div class="mt-6 space-y-2">${menu}</div>
      </aside>
      <div class="space-y-6">${content}</div>
    </section>
  `);
}

async function merchantPage() {
  stopDashboardPolling();
  state.me = await api('/api/auth/me');
  const stores = state.me.stores || [];
  const params = new URLSearchParams(window.location.search);
  const selectedStoreId = params.get('storeId') || stores[0]?.id || '';
  state.dashboard = await api(`/api/dashboard/summary${selectedStoreId ? `?storeId=${encodeURIComponent(selectedStoreId)}` : ''}`);
  const { store, stats, recentOrders, recentCheckouts, issues } = state.dashboard;
  const stripeWebhookEndpoint = webhookUrl(`/webhooks/stripe/${store.hookId}`);
  const nowpaymentsWebhookEndpoint = webhookUrl(`/webhooks/nowpayments/${store.hookId}`);
  const merchantCheckoutEndpoint = webhookUrl('/api/merchant/checkout-sessions');

  if (!store) {
    dashboardShell(
      'Merchant',
      `<div class="rounded-2xl border border-white/10 px-4 py-3 text-soft">No stores yet</div>`,
      `
        <section class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-3xl font-bold text-white">Create your first store</h2>
          <p class="mt-3 text-soft">This account does not have any stores yet. Create one now and it will appear in your dashboard.</p>
          <form id="createStoreForm" class="mt-6 grid max-w-2xl gap-3">
            <input name="name" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store name" />
            <input name="slug" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store slug" />
            <input name="defaultCurrency" value="USD" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Default currency" />
            <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Create store</button>
            <div id="createStoreMessage" class="text-sm text-soft"></div>
          </form>
        </section>
      `
    );

    document.getElementById('createStoreForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const created = await api('/api/stores', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(form.entries()))
        });
        window.location.href = `/dashboard?storeId=${encodeURIComponent(created.id)}`;
      } catch (error) {
        document.getElementById('createStoreMessage').textContent = error.message;
      }
    });
    return;
  }

  dashboardShell(
    'Merchant',
    `
      <select id="storePicker" class="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white">
        ${stores.map((item) => `<option value="${item.id}" ${item.id === store.id ? 'selected' : ''}>${item.name}</option>`).join('')}
      </select>
      <div class="rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-accent">Hook ID ${store.hookId}</div>
      <div class="rounded-2xl border border-white/10 px-4 py-3 text-soft">Gateway mode only</div>
      <button id="newStoreButton" class="w-full rounded-2xl border border-white/10 px-4 py-3 text-soft hover:text-white">Create another store</button>
    `,
    `
      <section class="grid gap-4 md:grid-cols-4">
        <div id="dashboardStats" class="contents">${renderDashboardStats(stats, store.defaultCurrency)}</div>
      </section>
      <section class="grid gap-6 xl:grid-cols-2">
        <div class="glass min-w-0 rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Gateway settings</h2>
          <form id="storeForm" class="mt-5 grid gap-3">
            <input name="name" value="${store.name}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store name" />
            <div class="grid gap-3 md:grid-cols-2">
              <input name="defaultCurrency" value="${store.defaultCurrency}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Default currency" />
              <input name="taxRate" value="${store.taxRate}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Tax rate" />
            </div>
            <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Save settings</button>
            <div id="storeMessage" class="text-sm text-soft"></div>
          </form>
        </div>
        <div class="glass min-w-0 rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Gateway config</h2>
          <form id="gatewayForm" class="mt-5 grid gap-6">
            <div class="grid gap-3 md:grid-cols-2">
              ${secretGatewayFields.map(([key, label]) => `
                <label class="grid min-w-0 gap-2 rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span class="min-w-0 text-sm text-white">${label}</span>
                    <span class="shrink-0 text-xs uppercase tracking-[0.3em] ${store.configPreview?.[`${key}Configured`] ? 'text-accent' : 'text-soft'}">${store.configPreview?.[`${key}Configured`] ? 'Saved' : 'Empty'}</span>
                  </div>
                  <input name="${key}" class="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="${label}" />
                </label>
              `).join('')}
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              ${walletGatewayFields.map(([key, label]) => `
                <label class="grid min-w-0 gap-2 rounded-3xl border border-white/10 bg-black/20 p-4">
                  <span class="min-w-0 text-sm text-white">${label}</span>
                  <input name="${key}" value="${escapeHtml(store.wallets?.[key] || '')}" class="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="${label}" />
                </label>
              `).join('')}
            </div>
            <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Save encrypted config</button>
            <div id="gatewayMessage" class="text-sm text-soft"></div>
          </form>
        </div>
      </section>
      <section class="grid gap-6 xl:grid-cols-2">
        <div class="glass min-w-0 rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">API key</h2>
          <div class="mt-4 text-sm text-soft">Use this store secret key from your other website to create hosted checkout sessions through the merchant API.</div>
          <div class="mt-4 min-w-0 break-all rounded-2xl border border-white/10 bg-black/30 p-4 text-white">Public key: ${store.apiKeys?.publicKey || 'Not set'}</div>
          <div class="mt-3 min-w-0 break-all rounded-2xl border border-white/10 bg-black/30 p-4 text-white">Secret key last 4: ${store.apiKeys?.secretKeyLast4 || '----'}</div>
          <div class="mt-3 min-w-0 break-all rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-soft">
            Merchant API endpoint:<br />
            <code class="break-all text-white">${merchantCheckoutEndpoint}</code><br /><br />
            Send your store secret key as:<br />
            <code class="break-all text-white">Authorization: Bearer YOUR_STORE_SECRET_KEY</code>
          </div>
          <button id="rotateApiKeyButton" class="mt-4 rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Rotate secret API key</button>
          <div id="apiKeyMessage" class="mt-3 text-sm text-soft"></div>
        </div>
        <div class="glass min-w-0 rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Hosted checkout session</h2>
          <div class="mt-3 rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-soft">
            <code>/api/merchant/checkout-sessions</code> auto-filters <code>allowedMethods</code> to only the methods enabled in this gateway config. If you omit <code>allowedMethods</code>, all enabled methods are used.
          </div>
          <form id="hostedCheckoutForm" class="mt-5 grid gap-3">
            <input name="itemName" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Item name" />
            <input name="itemDescription" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Item description" />
            <div class="grid gap-3 md:grid-cols-2">
              <input name="amount" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Amount" />
              <input name="currency" value="${store.defaultCurrency}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Currency" />
            </div>
            <input name="externalId" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="External order ID optional" />
            <input name="notificationUrl" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Webhook URL on merchant site" />
            <input name="successUrl" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Success URL optional" />
            <input name="cancelUrl" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Cancel URL optional" />
            <textarea name="metadata" class="min-h-[120px] rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder='Metadata JSON, e.g. {"productId":"vip-gold-01","userId":"42"}'></textarea>
            <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Create hosted checkout</button>
            <div id="hostedCheckoutMessage" class="text-sm text-soft"></div>
          </form>
        </div>
      </section>
      <section class="grid gap-6 xl:grid-cols-2">
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Provider webhooks to NekoPay</h2>
          <div class="mt-4 space-y-4 text-sm text-soft">
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">Stripe</div>
              <div class="mt-2">Webhook URL to paste into Stripe:</div>
              <code class="mt-2 block break-all text-white">${stripeWebhookEndpoint}</code>
              <div class="mt-3">Recommended event:</div>
              <code class="text-white">checkout.session.completed</code>
              <div class="mt-3">Put your Stripe signing secret into the dashboard field:</div>
              <code class="text-white">Stripe webhook secret</code>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">NOWPayments</div>
              <div class="mt-2">IPN URL to paste into NOWPayments:</div>
              <code class="mt-2 block break-all text-white">${nowpaymentsWebhookEndpoint}</code>
              <div class="mt-3">Put your NOWPayments IPN secret into the dashboard field:</div>
              <code class="text-white">NOWPayments IPN secret</code>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">PayPal</div>
              <div class="mt-2">Webhook URL to paste into PayPal:</div>
              <code class="mt-2 block break-all text-white">${webhookUrl(`/webhooks/paypal/${store.hookId}`)}</code>
              <div class="mt-3">Recommended events:</div>
              <code class="block text-white">CHECKOUT.ORDER.APPROVED</code>
              <code class="block text-white">PAYMENT.CAPTURE.COMPLETED</code>
              <code class="block text-white">PAYMENT.CAPTURE.PENDING</code>
              <code class="block text-white">PAYMENT.CAPTURE.DENIED</code>
              <div class="mt-3">Put your PayPal webhook ID into the dashboard field:</div>
              <code class="text-white">PayPal webhook ID</code>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">ZBD</div>
              <div class="mt-2">Webhook URL to paste into ZBD callbacks for gamertag charges:</div>
              <code class="mt-2 block break-all text-white">${webhookUrl(`/webhooks/zbd/${store.hookId}`)}</code>
              <div class="mt-3">Store the provider key in:</div>
              <code class="text-white">ZBD API key</code>
              <div class="mt-3">Set the receiver fields in gateway config:</div>
              <code class="block text-white">ZBD receiver type</code>
              <code class="block text-white">ZBD gamertag</code>
              <code class="block text-white">ZBD lightning address</code>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">Direct-chain crypto</div>
              <div class="mt-2">Hive, HBD, Steem, SBD, Blurt, Telos, EOS, FIO, WAX, PIVX, and FLS do not need provider webhooks here. NekoPay checks the chain/payment state directly.</div>
              <div class="mt-3">EVM methods are temporarily disabled right now because the explorer API is blocking requests.</div>
            </div>
          </div>
        </div>
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Merchant webhook from NekoPay</h2>
          <div class="mt-4 space-y-4 text-sm text-soft">
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">Your site callback URL</div>
              <div class="mt-2">When you create a hosted checkout session, set:</div>
              <code class="text-white">notificationUrl</code>
              <div class="mt-2">That URL is on your own site, not inside NekoPay.</div>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">Events sent to your site</div>
              <div class="mt-2"><code class="text-white">checkout.created</code></div>
              <div><code class="text-white">checkout.pending</code></div>
              <div><code class="text-white">checkout.completed</code></div>
              <div><code class="text-white">checkout.failed</code></div>
              <div><code class="text-white">checkout.cancelled</code></div>
            </div>
            <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div class="text-white">What to store on your side</div>
              <div class="mt-2">Keep your store secret API key private. NekoPay does not sign outbound merchant webhooks yet, so your notification URL should still validate the payload using session IDs, external IDs, and your own order mapping.</div>
            </div>
          </div>
        </div>
      </section>
      <section id="newStorePanel" class="hidden glass rounded-[2rem] border border-white/10 p-6">
        <h2 class="text-2xl font-bold text-white">Create another store</h2>
        <form id="createStoreForm" class="mt-5 grid max-w-2xl gap-3">
          <input name="name" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store name" />
          <input name="slug" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store slug" />
          <input name="defaultCurrency" value="USD" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Default currency" />
          <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black">Create store</button>
          <div id="createStoreMessage" class="text-sm text-soft"></div>
        </form>
      </section>
      <section class="grid gap-6 xl:grid-cols-2">
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Recent checkout sessions</h2>
          <div id="recentCheckoutsList" class="mt-4 space-y-3">${renderRecentCheckoutSessions(recentCheckouts)}</div>
        </div>
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Legacy orders and support</h2>
          <div class="space-y-3">${recentOrders.map((o) => `<details class="rounded-2xl border border-white/10 p-4"><summary class="flex cursor-pointer list-none items-center justify-between gap-3"><div class="text-white">${o.id}</div><div class="${o.status === 'paid' ? 'text-accent' : 'text-soft'}">${o.status}</div></summary><div class="mt-3 text-sm text-soft">${o.customer.email || 'No email'} | ${money(o.totals.total, o.totals.storeCurrency)}</div><pre class="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-3 text-xs text-white">${prettyJson(o)}</pre></details>`).join('') || `<div class="text-soft">No legacy public-store orders.</div>`}</div>
          <form id="issueForm" class="mt-4 grid gap-3">
            <input name="title" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Issue title" />
            <textarea name="message" class="min-h-[120px] rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Describe the issue"></textarea>
            <button class="rounded-2xl border border-accent/30 px-5 py-3 text-accent">Open issue</button>
            <div id="issueMessage" class="text-sm text-soft"></div>
          </form>
          <div class="mt-6 space-y-3">${issues.map((i) => `<div class="rounded-2xl border border-white/10 p-4"><div class="text-white">${i.title}</div><div class="mt-2 text-sm text-soft">${i.message}</div><div class="mt-2 text-xs uppercase tracking-[0.3em] text-accent">${i.status}</div></div>`).join('') || `<div class="text-soft">No issues.</div>`}</div>
        </div>
      </section>
    `
  );

  document.getElementById('storePicker').addEventListener('change', (event) => {
    window.location.href = `/dashboard?storeId=${encodeURIComponent(event.target.value)}`;
  });

  document.getElementById('newStoreButton').addEventListener('click', () => {
    document.getElementById('newStorePanel').classList.toggle('hidden');
  });

  document.getElementById('createStoreForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api('/api/stores', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      window.location.href = `/dashboard?storeId=${encodeURIComponent(created.id)}`;
    } catch (error) {
      document.getElementById('createStoreMessage').textContent = error.message;
    }
  });

  document.getElementById('storeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/stores/${store.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.get('name'),
          defaultCurrency: form.get('defaultCurrency'),
          taxRate: Number(form.get('taxRate'))
        })
      });
      document.getElementById('storeMessage').textContent = 'Store saved.';
    } catch (error) {
      document.getElementById('storeMessage').textContent = error.message;
    }
  });

  document.getElementById('gatewayForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/stores/${store.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gatewaySecrets: {
            stripeSecretKey: form.get('stripeSecretKey'),
            stripeWebhookSecret: form.get('stripeWebhookSecret'),
            paypalClientId: form.get('paypalClientId'),
            paypalClientSecret: form.get('paypalClientSecret'),
            paypalWebhookId: form.get('paypalWebhookId'),
            nowpaymentsApiKey: form.get('nowpaymentsApiKey'),
            nowpaymentsIpnSecret: form.get('nowpaymentsIpnSecret'),
            zbdApiKey: form.get('zbdApiKey')
          },
          wallets: {
            hiveAddress: form.get('hiveAddress'),
            hbdAddress: form.get('hbdAddress'),
            steemAddress: form.get('steemAddress'),
            sbdAddress: form.get('sbdAddress'),
            blurtAddress: form.get('blurtAddress'),
            ethAddress: form.get('ethAddress'),
            polAddress: form.get('polAddress'),
            bnbAddress: form.get('bnbAddress'),
            tlosAddress: form.get('tlosAddress'),
            eosAddress: form.get('eosAddress'),
            fioPublicKey: form.get('fioPublicKey'),
            waxAddress: form.get('waxAddress'),
            pivxAddress: form.get('pivxAddress'),
            flsAddress: form.get('flsAddress'),
            zbdReceiverType: form.get('zbdReceiverType'),
            zbdGamertag: form.get('zbdGamertag'),
            zbdLightningAddress: form.get('zbdLightningAddress')
          }
        })
      });
      document.getElementById('gatewayMessage').textContent = 'Encrypted gateway config saved.';
    } catch (error) {
      document.getElementById('gatewayMessage').textContent = error.message;
    }
  });

  document.getElementById('issueForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/stores/${store.id}/issues`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
      document.getElementById('issueMessage').textContent = 'Issue opened.';
    } catch (error) {
      document.getElementById('issueMessage').textContent = error.message;
    }
  });

  document.getElementById('rotateApiKeyButton').addEventListener('click', async () => {
    try {
      const rotated = await api(`/api/stores/${store.id}/api-key/rotate`, { method: 'POST' });
      document.getElementById('apiKeyMessage').innerHTML = `New secret key: <code>${rotated.issuedSecretKey}</code>`;
    } catch (error) {
      document.getElementById('apiKeyMessage').textContent = error.message;
    }
  });

  document.getElementById('hostedCheckoutForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const metadataRaw = String(form.get('metadata') || '').trim();
      const created = await api(`/api/stores/${store.id}/checkout-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          itemName: form.get('itemName'),
          itemDescription: form.get('itemDescription'),
          amount: Number(form.get('amount')),
          currency: form.get('currency'),
          externalId: form.get('externalId'),
          notificationUrl: form.get('notificationUrl'),
          successUrl: form.get('successUrl'),
          cancelUrl: form.get('cancelUrl'),
          metadata: metadataRaw ? JSON.parse(metadataRaw) : {}
        })
      });
      document.getElementById('hostedCheckoutMessage').innerHTML = `
        Checkout URL: <a class="text-accent" href="${created.checkoutUrl}" target="_blank">${created.checkoutUrl}</a><br />
        Embed URL: <a class="text-accent" href="${created.embedUrl}" target="_blank">${created.embedUrl}</a><br />
        Allowed methods: ${(created.session?.allowedMethods || []).join(', ') || '-'}<br />
        Session ID: ${created.session?.id || created.sessionId}
      `;
    } catch (error) {
      document.getElementById('hostedCheckoutMessage').textContent = error.message;
    }
  });

  startStatusPolling('dashboardSummaryTimer', async () => {
    if (window.location.pathname !== '/dashboard') {
      stopDashboardPolling();
      return;
    }

    try {
      const latest = await api(`/api/dashboard/summary?storeId=${encodeURIComponent(store.id)}`);
      const statsNode = document.getElementById('dashboardStats');
      const checkoutsNode = document.getElementById('recentCheckoutsList');
      if (statsNode) {
        statsNode.innerHTML = renderDashboardStats(latest.stats, latest.store.defaultCurrency);
      }
      if (checkoutsNode) {
        checkoutsNode.innerHTML = renderRecentCheckoutSessions(latest.recentCheckouts || []);
      }
    } catch {
      // Keep the current dashboard view if a poll fails.
    }
  }, 10000);
}

async function adminPage() {
  state.me = await api('/api/auth/me');
  state.admin = await api('/api/admin/summary');
  const d = state.admin;
  dashboardShell(
    'Admin',
    `<div class="rounded-2xl border border-white/10 px-4 py-3 text-soft">Platform control</div>`,
    `
      <section class="grid gap-4 md:grid-cols-5">${Object.entries(d.stats).map(([k, v]) => `<div class="glass rounded-[2rem] border border-white/10 p-5"><div class="text-soft">${k}</div><div class="mt-2 text-3xl font-bold text-white">${v}</div></div>`).join('')}</section>
      <section class="glass rounded-[2rem] border border-white/10 p-6">
        <h2 class="text-2xl font-bold text-white">Create store for user</h2>
        <form id="adminCreateStoreForm" class="mt-5 grid max-w-3xl gap-3 md:grid-cols-2">
          <select name="ownerUserId" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white">
            ${d.users.map((u) => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')}
          </select>
          <input name="name" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store name" />
          <input name="slug" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Store slug" />
          <input name="defaultCurrency" value="USD" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Default currency" />
          <button class="rounded-2xl bg-accent px-5 py-3 font-semibold text-black md:col-span-2">Create store</button>
          <div id="adminCreateStoreMessage" class="text-sm text-soft md:col-span-2"></div>
        </form>
      </section>
      <section class="grid gap-6 xl:grid-cols-2">
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Users</h2>
          <div class="mt-4 space-y-3">${d.users.map((u) => `<div class="rounded-2xl border border-white/10 p-4"><div class="flex items-center justify-between gap-3"><div><div class="text-white">${u.name}</div><div class="text-sm text-soft">${u.email}</div></div><button data-user-id="${u.id}" data-next="${u.status === 'active' ? 'suspended' : 'active'}" class="rounded-full border border-white/10 px-4 py-2 text-sm text-soft">${u.status === 'active' ? 'Suspend' : 'Activate'}</button></div></div>`).join('')}</div>
        </div>
        <div class="glass rounded-[2rem] border border-white/10 p-6">
          <h2 class="text-2xl font-bold text-white">Issues</h2>
          <div class="mt-4 space-y-3">${d.issues.map((i) => `<div class="rounded-2xl border border-white/10 p-4"><div class="flex items-center justify-between gap-3"><div class="text-white">${i.title}</div><button data-issue-id="${i.id}" data-next="${i.status === 'open' ? 'closed' : 'open'}" class="rounded-full border border-white/10 px-4 py-2 text-sm text-soft">${i.status}</button></div><div class="mt-2 text-sm text-soft">${i.message}</div></div>`).join('')}</div>
        </div>
      </section>
    `
  );

  document.querySelectorAll('[data-user-id]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/admin/users/${button.dataset.userId}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.next }) });
    await adminPage();
  }));
  document.querySelectorAll('[data-issue-id]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/admin/issues/${button.dataset.issueId}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.next }) });
    await adminPage();
  }));
  document.getElementById('adminCreateStoreForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api('/api/stores', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      document.getElementById('adminCreateStoreMessage').textContent = `Created store ${created.name}.`;
      await adminPage();
    } catch (error) {
      document.getElementById('adminCreateStoreMessage').textContent = error.message;
    }
  });
}

async function publicStorePage(slug, embed = false) {
  stopStatusPolling('checkoutStatusTimer');
  const currentCurrency = new URLSearchParams(window.location.search).get('currency') || 'USD';
  state.publicStore = await api(`/api/public/stores/${slug}?currency=${encodeURIComponent(currentCurrency)}`);
  const { store, products, displayCurrency } = state.publicStore;
  const methods = Object.entries(store.gatewayState || {}).filter(([, enabled]) => enabled).map(([key]) => key);

  const content = `
      <section class="mx-auto grid max-w-7xl gap-6 px-4 py-6 ${embed ? '' : 'lg:grid-cols-[360px_1fr]'}">
        <aside class="glass rounded-[2rem] border border-white/10 p-6 shadow-glow">
          <div class="text-sm uppercase tracking-[0.3em] text-soft">${store.name}</div>
          <div class="mt-3 text-3xl font-bold text-white">Checkout</div>
          <label class="mt-6 block text-sm text-soft">Currency</label>
          <select id="currencySelect" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white">${store.supportedDisplayCurrencies.map((code) => `<option value="${code}" ${code === displayCurrency ? 'selected' : ''}>${code}</option>`).join('')}</select>
          <div class="mt-6 space-y-3">${products.map((p) => `<div class="rounded-2xl border border-white/10 bg-black/30 p-4"><div class="text-white">${p.name}</div><div class="mt-2 text-soft">${money(p.displayPrice, displayCurrency)}</div></div>`).join('')}</div>
        </aside>
        <div class="glass rounded-[2rem] border border-white/10 p-6 shadow-glow">
          <div class="flex items-center justify-between gap-3"><h1 class="text-4xl font-bold text-white">${store.name}</h1><div class="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-sm text-accent">Hook ${store.hookId}</div></div>
          <form id="checkoutForm" class="mt-8 grid gap-6">
            <div class="grid gap-4 md:grid-cols-3">${products.map((p, i) => `<label class="rounded-[1.5rem] border border-white/10 bg-black/30 p-5"><input ${i === 0 ? 'checked' : ''} type="checkbox" name="product" value="${p.id}" class="mb-4 h-4 w-4 accent-[#7ddc5b]" /><div class="text-xl font-bold text-white">${p.name}</div><div class="mt-2 text-sm text-soft">${p.description || ''}</div><div class="mt-4 text-lg font-semibold text-accent">${money(p.displayPrice, displayCurrency)}</div></label>`).join('')}</div>
            <div class="grid gap-4 md:grid-cols-3">
              <input name="email" type="email" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Customer email" />
              <input name="fullName" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Full name" />
              <input name="postalCode" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Postal code" />
            </div>
            <div class="grid gap-3 md:grid-cols-4">${methods.map((m, i) => `<label class="rounded-2xl border border-white/10 bg-black/30 p-4 text-center"><input ${i === 0 ? 'checked' : ''} type="radio" name="methodId" value="${m}" class="mb-3 h-4 w-4 accent-[#7ddc5b]" /><div class="font-medium text-white">${escapeHtml(methodLabel(m))}</div></label>`).join('')}</div>
            <button class="rounded-2xl bg-accent px-5 py-4 text-lg font-semibold text-black">Create payment</button>
            <div id="checkoutMessage" class="text-sm text-soft"></div>
          </form>
        </div>
      </section>
  `;

  if (embed) {
    app.innerHTML = `<main class="px-0 py-0">${content}</main>`;
  } else {
    shell(content, state.me?.user);
  }

  document.getElementById('currencySelect').addEventListener('change', (event) => {
    window.location.href = `${embed ? '/embed/' : '/s/'}${slug}?currency=${encodeURIComponent(event.target.value)}`;
  });

  document.getElementById('checkoutForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const order = await api(`/api/public/stores/${slug}/orders`, {
      method: 'POST',
      body: JSON.stringify({
        email: form.get('email'),
        fullName: form.get('fullName'),
        postalCode: form.get('postalCode'),
        displayCurrency,
        items: form.getAll('product').map((productId) => ({ productId, quantity: 1 }))
      })
    });
    const payment = await api(`/api/public/orders/${order.id}/payment`, {
      method: 'POST',
      body: JSON.stringify({ methodId: form.get('methodId') })
    });

    if (payment.redirectUrl) {
    document.getElementById('checkoutMessage').textContent = 'Redirecting to provider...';
      window.location.href = payment.redirectUrl;
      return;
    }

    const renderCheckoutStatus = (refreshedOrder = null) => {
      const currentOrder = refreshedOrder || order;
      renderPaymentStatus('checkoutMessage', {
        title: `Payment created for ${order.id}.`,
        status: currentOrder.status,
        paymentAttempt: currentOrder.paymentAttempt,
        fallbackPayment: payment,
        refreshButtonId: 'statusButton'
      });
      document.getElementById('statusButton').addEventListener('click', refreshCheckoutStatus);
    };

    const refreshCheckoutStatus = async () => {
      const refreshed = await api(`/api/public/orders/${order.id}/status`);
      renderCheckoutStatus(refreshed);
      if (['Completed', 'Failed', 'Cancelled'].includes(formatStatus(refreshed.status))) {
        stopStatusPolling('checkoutStatusTimer');
      }
    };

    renderCheckoutStatus({
      ...order,
      paymentAttempt: payment
    });
    startStatusPolling('checkoutStatusTimer', refreshCheckoutStatus);
  });
}

async function hostedCheckoutPage(sessionId, embed = false) {
  stopStatusPolling('hostedStatusTimer');
  const payload = await api(`/api/public/checkout-sessions/${sessionId}`);
  const { session, store } = payload;
  const methods = (session.allowedMethods || []).filter((method) => store.gatewayState?.[method]);
  const lockedStatus = formatStatus(session.status);
  const isLocked = ['Completed', 'Failed', 'Cancelled'].includes(lockedStatus);
  const lockedHeading = lockedStatus === 'Completed'
    ? 'Already paid'
    : lockedStatus === 'Failed'
      ? 'Payment failed'
      : lockedStatus === 'Cancelled'
        ? 'Payment cancelled'
        : `Checkout ${lockedStatus.toLowerCase()}`;
  const lockedDescription = lockedStatus === 'Completed'
    ? 'This checkout session has already been paid and cannot be used again.'
    : lockedStatus === 'Failed'
      ? 'Payment failed. Please try again or contact support.'
      : lockedStatus === 'Cancelled'
        ? 'Payment was cancelled. Please try again or contact support.'
        : `This checkout session is ${lockedStatus.toLowerCase()} and cannot be used again.`;
  const content = `
      <section class="mx-auto grid max-w-6xl gap-6 px-4 py-6 ${embed ? '' : 'lg:grid-cols-[340px_1fr]'}">
        <aside class="glass rounded-[2rem] border border-white/10 p-6 shadow-glow">
          <div class="text-sm uppercase tracking-[0.3em] text-soft">${store.name}</div>
          <div class="mt-3 text-3xl font-bold text-white">Checkout</div>
          <div class="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div class="text-white">${session.itemName}</div>
            <div class="mt-2 text-soft">${session.itemDescription || ''}</div>
            <div class="mt-4 text-2xl font-bold text-accent">${money(session.amount, session.currency)}</div>
          </div>
          <div class="mt-4 rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-sm text-accent">Status ${session.status}</div>
        </aside>
        <div class="glass rounded-[2rem] border border-white/10 p-6 shadow-glow">
          <div class="flex items-center justify-between gap-3">
            <h1 class="text-4xl font-bold text-white">${session.itemName}</h1>
            ${isLocked ? '' : '<button id="cancelHostedCheckoutButton" class="rounded-full border border-white/10 px-4 py-2 text-sm text-soft hover:text-white">Cancel</button>'}
          </div>
          ${isLocked ? `
          <div class="mt-8 grid gap-6">
            <div class="rounded-2xl border border-white/10 bg-black/30 p-5">
              <div class="text-2xl font-semibold text-white">${lockedHeading}</div>
              <div class="mt-2 text-soft">${lockedDescription}</div>
            </div>
            <div id="hostedPayMessage" class="text-sm text-soft"></div>
            <button id="hostedCheckoutBackButton" class="rounded-2xl border border-white/10 px-5 py-4 text-lg font-semibold text-white">Go back</button>
          </div>
          ` : `<form id="hostedCheckoutPayForm" class="mt-8 grid gap-6">
            <div class="grid gap-4 md:grid-cols-3">
              <input name="email" value="${session.customer?.email || ''}" type="email" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Customer email" />
              <input name="fullName" value="${session.customer?.fullName || ''}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Full name" />
              <input name="postalCode" value="${session.customer?.postalCode || ''}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Postal code" />
            </div>
            <div class="grid gap-3 md:grid-cols-4">${methods.map((m, i) => `<label class="rounded-2xl border border-white/10 bg-black/30 p-4 text-center"><input ${i === 0 ? 'checked' : ''} type="radio" name="methodId" value="${m}" class="mb-3 h-4 w-4 accent-[#7ddc5b]" /><div class="font-medium text-white">${escapeHtml(methodLabel(m))}</div></label>`).join('')}</div>
            <button class="rounded-2xl bg-accent px-5 py-4 text-lg font-semibold text-black">Create payment</button>
            <div id="hostedPayMessage" class="text-sm text-soft"></div>
          </form>`}
        </div>
      </section>
  `;
  if (embed) app.innerHTML = `<main>${content}</main>`;
  else shell(content, state.me?.user);

  if (isLocked) {
    renderPaymentStatus('hostedPayMessage', {
      title: `${lockedHeading}.`,
      status: session.status,
      paymentAttempt: session.payment || session.paymentAttempt || null,
      refreshButtonId: null
    });
    document.getElementById('hostedCheckoutBackButton').addEventListener('click', () => {
      if (document.referrer) {
        window.location.href = document.referrer;
        return;
      }
      if (lockedStatus === 'Completed' && session.successUrl) {
        window.location.href = session.successUrl;
        return;
      }
      if (lockedStatus === 'Cancelled' && session.cancelUrl) {
        window.location.href = session.cancelUrl;
        return;
      }
      window.history.back();
    });
    return;
  }

  document.getElementById('cancelHostedCheckoutButton').addEventListener('click', async () => {
    await api(`/api/public/checkout-sessions/${sessionId}/cancel`, { method: 'POST' });
    if (session.cancelUrl) window.location.href = session.cancelUrl;
    else window.location.reload();
  });

  document.getElementById('hostedCheckoutPayForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payment = await api(`/api/public/checkout-sessions/${sessionId}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          methodId: form.get('methodId'),
          customer: {
            email: form.get('email'),
            fullName: form.get('fullName'),
            postalCode: form.get('postalCode')
          }
        })
      });
      if (payment.redirectUrl) {
        document.getElementById('hostedPayMessage').textContent = 'Redirecting to provider...';
        window.location.href = payment.redirectUrl;
        return;
      }
      const renderHostedStatus = (refreshedSession = null) => {
        const currentSession = refreshedSession || session;
        renderPaymentStatus('hostedPayMessage', {
          title: 'Payment created.',
          status: currentSession.status,
          paymentAttempt: currentSession.paymentAttempt,
          fallbackPayment: payment,
          refreshButtonId: 'refreshHostedStatus'
        });
        document.getElementById('refreshHostedStatus').addEventListener('click', refreshHostedStatus);
      };

      const refreshHostedStatus = async () => {
        const refreshed = await api(`/api/public/checkout-sessions/${sessionId}/status`);
        renderHostedStatus(refreshed);
        if (formatStatus(refreshed.status) === 'Completed') {
          stopStatusPolling('hostedStatusTimer');
          if (refreshed.successUrl) {
            window.location.href = refreshed.successUrl;
          }
          return;
        }
        if (['Failed', 'Cancelled'].includes(formatStatus(refreshed.status))) {
          stopStatusPolling('hostedStatusTimer');
        }
      };

      renderHostedStatus({
        ...session,
        status: 'Pending',
        paymentAttempt: payment
      });
      startStatusPolling('hostedStatusTimer', refreshHostedStatus);
    } catch (error) {
      document.getElementById('hostedPayMessage').textContent = error.message;
    }
  });
}

async function init() {
  state.bootstrap = await api('/api/bootstrap');
  try { state.me = await api('/api/auth/me'); } catch { state.me = null; }
  const [first, second] = pathname();
  if (!first) return heroPage();
  if (first === 'register') return authPage('register');
  if (first === 'login') return authPage('login');
  if (first === 'verify') return verifyPage();
  if (first === 'dashboard') {
    if (!state.me?.user) return (window.location.href = '/login');
    return merchantPage();
  }
  if (first === 'admin') {
    if (!state.me?.user) return (window.location.href = '/login');
    return adminPage();
  }
  if (first === 'pay' && second) return hostedCheckoutPage(second, false);
  if (first === 'embed' && second === 'pay' && pathname()[2]) return hostedCheckoutPage(pathname()[2], true);
  return heroPage();
}

init().catch((error) => {
  shell(`<section class="mx-auto max-w-3xl px-6 py-20"><div class="glass rounded-[2rem] border border-white/10 p-8 shadow-glow"><h1 class="text-4xl font-bold text-white">Something went wrong</h1><div class="mt-4 text-soft">${error.message}</div></div></section>`);
});
