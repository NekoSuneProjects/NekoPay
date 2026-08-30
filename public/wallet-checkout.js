'use strict';

(() => {
  const rawFetch = window.fetch.bind(window);
  const state = {
    bootstrap: null,
    latestPayment: null,
    latestSelection: null,
    forms: new WeakMap()
  };

  const stableSymbols = new Set(['USDC', 'USDC.E', 'USDT', 'DAI', 'TUSD', 'PYUSD']);
  const nativeNetworks = {
    hive: 'Hive', hbd: 'Hive', steem: 'Steem', sbd: 'Steem', blurt: 'Blurt',
    tlos: 'Telos', eos: 'EOS', fio: 'FIO', wax: 'WAX', pivx: 'PIVX', fls: 'FLS'
  };
  const networkPriority = ['Ethereum', 'Polygon', 'BNB Chain', 'Solana', 'Hive', 'Steem', 'Blurt', 'Telos', 'EOS', 'FIO', 'WAX', 'PIVX', 'FLS'];
  const evmNetworks = {
    Ethereum: {
      chainId: '0x1', chainIdDecimal: 1, chainName: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-rpc.publicnode.com'], blockExplorerUrls: ['https://etherscan.io']
    },
    Polygon: {
      chainId: '0x89', chainIdDecimal: 137, chainName: 'Polygon',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-bor-rpc.publicnode.com'], blockExplorerUrls: ['https://polygonscan.com']
    },
    'BNB Chain': {
      chainId: '0x38', chainIdDecimal: 56, chainName: 'BNB Smart Chain',
      nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      rpcUrls: ['https://bsc-rpc.publicnode.com'], blockExplorerUrls: ['https://bscscan.com']
    }
  };

  function config(methodId) {
    return state.bootstrap?.supportedTokens?.[String(methodId || '').toLowerCase()] || null;
  }

  function networkName(methodId, token = config(methodId)) {
    return token?.network || nativeNetworks[String(methodId || '').toLowerCase()] || token?.label || String(methodId || '').toUpperCase();
  }

  function symbol(token) {
    return String(token?.invoiceSymbol || token?.symbol || '').toUpperCase();
  }

  function stable(token) {
    return stableSymbols.has(symbol(token));
  }

  function shortAddress(value) {
    const text = String(value || '');
    if (text.length < 15) return text;
    return `${text.slice(0, 6)}…${text.slice(-4)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function decimalToUnits(value, decimals) {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid payment amount');
    const [whole = '0', fraction = ''] = text.split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return (BigInt(whole) * (10n ** BigInt(decimals))) + BigInt(padded || '0');
  }

  function sortedNetworks(methods) {
    return [...new Set(methods.map((id) => networkName(id)))].sort((a, b) => {
      const ai = networkPriority.indexOf(a);
      const bi = networkPriority.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  function injectedProviders() {
    const root = window.ethereum;
    if (!root) return [];
    if (Array.isArray(root.providers) && root.providers.length) return root.providers;
    return [root];
  }

  function evmProvider(kind) {
    const providers = injectedProviders();
    if (kind === 'metamask') return providers.find((p) => p?.isMetaMask && !p?.isCoinbaseWallet) || null;
    if (kind === 'coinbase') return providers.find((p) => p?.isCoinbaseWallet) || null;
    if (kind === 'trust') return providers.find((p) => p?.isTrust || p?.isTrustWallet) || null;
    return providers[0] || null;
  }

  function phantomProvider() {
    return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
  }

  function keychainFor(kind) {
    if (kind === 'hive-keychain') return window.hive_keychain || null;
    if (kind === 'steem-keychain') return window.steem_keychain || null;
    if (kind === 'blurt-keychain') return window.blurt_keychain || null;
    return null;
  }

  function walletCatalog(methods) {
    const hasEvm = methods.some((id) => config(id)?.chainType === 'evm');
    const hasSol = methods.some((id) => config(id)?.chainType === 'solana');
    const hasHive = methods.some((id) => networkName(id) === 'Hive');
    const hasSteem = methods.some((id) => networkName(id) === 'Steem');
    const hasBlurt = methods.some((id) => networkName(id) === 'Blurt');
    return [
      hasEvm && { id: 'metamask', name: 'MetaMask', family: 'evm', mark: 'M', detected: Boolean(evmProvider('metamask')) },
      hasEvm && { id: 'coinbase', name: 'Coinbase Wallet', family: 'evm', mark: 'C', detected: Boolean(evmProvider('coinbase')) },
      hasEvm && { id: 'trust', name: 'Trust Wallet', family: 'evm', mark: 'T', detected: Boolean(evmProvider('trust')) },
      hasSol && { id: 'phantom', name: 'Phantom', family: 'solana', mark: 'P', detected: Boolean(phantomProvider()) },
      hasHive && { id: 'hive-keychain', name: 'Hive Keychain', family: 'hive', mark: 'H', detected: Boolean(keychainFor('hive-keychain')) },
      hasSteem && { id: 'steem-keychain', name: 'Steem Keychain', family: 'steem', mark: 'S', detected: Boolean(keychainFor('steem-keychain')) },
      hasBlurt && { id: 'blurt-keychain', name: 'Blurt Keychain', family: 'blurt', mark: 'B', detected: Boolean(keychainFor('blurt-keychain')) },
      { id: 'qr', name: 'Other / mobile wallet', family: 'all', mark: 'QR', detected: true }
    ].filter(Boolean);
  }

  function compatibleMethods(methods, wallet) {
    if (!wallet || wallet.family === 'all') return methods;
    if (wallet.family === 'evm') return methods.filter((id) => config(id)?.chainType === 'evm');
    if (wallet.family === 'solana') return methods.filter((id) => config(id)?.chainType === 'solana');
    if (wallet.family === 'hive') return methods.filter((id) => networkName(id) === 'Hive');
    if (wallet.family === 'steem') return methods.filter((id) => networkName(id) === 'Steem');
    if (wallet.family === 'blurt') return methods.filter((id) => networkName(id) === 'Blurt');
    return methods;
  }

  async function switchEvmNetwork(provider, methodId) {
    const token = config(methodId);
    if (!provider?.request || token?.chainType !== 'evm') return;
    const chain = evmNetworks[networkName(methodId, token)];
    if (!chain) throw new Error('This EVM network is not configured for browser wallets');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainId }] });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [chain] });
    }
  }

  async function connectWallet(selection, wallet) {
    selection.wallet = wallet;
    selection.provider = null;
    selection.account = null;

    if (wallet.family === 'evm') {
      const provider = evmProvider(wallet.id);
      if (!provider?.request) throw new Error(`${wallet.name} was not detected in this browser. Install/open it, or choose Other / mobile wallet.`);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      selection.provider = provider;
      selection.account = accounts?.[0] || null;
      if (!selection.account) throw new Error(`${wallet.name} did not return an account`);
      return;
    }

    if (wallet.family === 'solana') {
      const provider = phantomProvider();
      if (!provider?.connect) throw new Error('Phantom was not detected. Install/open Phantom, or choose Other / mobile wallet.');
      const result = await provider.connect();
      selection.provider = provider;
      selection.account = result?.publicKey?.toString?.() || provider.publicKey?.toString?.() || null;
      if (!selection.account) throw new Error('Phantom did not return an account');
      return;
    }

    if (['hive', 'steem', 'blurt'].includes(wallet.family)) {
      selection.provider = keychainFor(wallet.id);
    }
  }

  function modalShell() {
    let overlay = document.getElementById('nekopayWalletModal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'nekopayWalletModal';
    overlay.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
    overlay.innerHTML = `
      <div class="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-[#111613] shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div id="nekopayWalletModalTitle" class="text-xl font-bold text-white">Choose a wallet</div>
          <button type="button" id="nekopayWalletModalClose" class="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-xl text-soft hover:text-white">×</button>
        </div>
        <div id="nekopayWalletModalBody" class="max-h-[72vh] overflow-y-auto p-5"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
    overlay.querySelector('#nekopayWalletModalClose').addEventListener('click', closeModal);
    return overlay;
  }

  function closeModal() {
    const modal = document.getElementById('nekopayWalletModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  function openModal() {
    const modal = modalShell();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function renderWalletList(form, selection) {
    const modal = modalShell();
    modal.querySelector('#nekopayWalletModalTitle').textContent = 'Choose a wallet';
    const body = modal.querySelector('#nekopayWalletModalBody');
    const wallets = walletCatalog(selection.methods);
    body.innerHTML = `
      <p class="mb-4 text-sm leading-6 text-soft">Connect a wallet like Coinbase Checkout. Crypto stays in your wallet until you approve the payment.</p>
      <div class="grid grid-cols-2 gap-3">
        ${wallets.map((wallet) => `
          <button type="button" data-wallet-id="${wallet.id}" class="min-h-[118px] rounded-2xl border border-white/10 bg-black/25 p-4 text-left hover:border-accent/40 hover:bg-accent/5">
            <div class="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-sm font-bold text-white">${wallet.mark}</div>
            <div class="mt-3 font-semibold text-white">${escapeHtml(wallet.name)}</div>
            <div class="mt-1 text-xs ${wallet.detected ? 'text-accent' : 'text-soft'}">${wallet.id === 'qr' ? 'No extension needed' : wallet.detected ? 'Detected' : 'Not detected'}</div>
          </button>`).join('')}
      </div>
      <div id="nekopayWalletModalStatus" class="mt-4 text-sm text-amber-300"></div>`;

    body.querySelectorAll('[data-wallet-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const wallet = wallets.find((item) => item.id === button.dataset.walletId);
        const status = body.querySelector('#nekopayWalletModalStatus');
        status.textContent = wallet.family === 'all' ? '' : `Connecting ${wallet.name}…`;
        try {
          await connectWallet(selection, wallet);
          renderAssetPicker(form, selection);
        } catch (error) {
          status.textContent = error.message;
        }
      });
    });
  }

  function renderAssetPicker(form, selection) {
    const modal = modalShell();
    modal.querySelector('#nekopayWalletModalTitle').textContent = 'Choose asset';
    const body = modal.querySelector('#nekopayWalletModalBody');
    const methods = compatibleMethods(selection.methods, selection.wallet);
    const networks = sortedNetworks(methods);
    const initialNetwork = methods.includes(selection.methodId) ? networkName(selection.methodId) : networks[0];
    const accountText = selection.account ? shortAddress(selection.account) : selection.wallet?.family === 'all' ? 'QR / manual payment' : 'Wallet selected';

    body.innerHTML = `
      <button type="button" id="nekopayWalletBack" class="mb-4 text-sm text-accent">← Change wallet</button>
      <div class="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div class="text-xs uppercase tracking-[0.2em] text-soft">Wallet</div>
        <div class="mt-1 flex items-center justify-between gap-3"><span class="font-semibold text-white">${escapeHtml(selection.wallet?.name || 'Wallet')}</span><span class="text-sm text-soft">${escapeHtml(accountText)}</span></div>
      </div>
      <div class="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4 text-sm leading-6 text-soft">
        NekoPay keeps the order in fiat and quotes the selected crypto when you continue. Example: a US$1.00 order is about 1 USDC/USDT; the server locks the exact token amount before you approve the transaction.
      </div>
      ${['hive', 'steem', 'blurt'].includes(selection.wallet?.family) ? `
        <label class="mt-4 grid gap-2 text-sm text-soft">Your ${escapeHtml(selection.wallet.name)} account
          <input id="nekopayPayerAccount" value="${escapeHtml(selection.payerAccount || '')}" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white" placeholder="Account name" />
        </label>` : ''}
      <label class="mt-4 grid gap-2 text-sm text-soft">Network
        <select id="nekopayNetworkSelect" class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white">
          ${networks.map((name) => `<option value="${escapeHtml(name)}" ${name === initialNetwork ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </label>
      <div class="mt-4 text-sm text-soft">Token / crypto</div>
      <div id="nekopayTokenList" class="mt-2 grid gap-2"></div>
      <div id="nekopayAssetStatus" class="mt-3 text-sm text-amber-300"></div>
      <button type="button" id="nekopayAssetContinue" class="mt-5 w-full rounded-2xl bg-accent px-5 py-4 text-lg font-semibold text-black">Use this wallet & asset</button>`;

    body.querySelector('#nekopayWalletBack').addEventListener('click', () => renderWalletList(form, selection));
    const networkSelect = body.querySelector('#nekopayNetworkSelect');
    const tokenList = body.querySelector('#nekopayTokenList');

    const renderTokens = () => {
      const network = networkSelect.value;
      const matching = methods
        .filter((id) => networkName(id) === network)
        .sort((a, b) => Number(stable(config(b))) - Number(stable(config(a))) || String(config(a)?.label || a).localeCompare(String(config(b)?.label || b)));
      if (!matching.includes(selection.methodId)) selection.methodId = matching.find((id) => stable(config(id))) || matching[0] || null;
      tokenList.innerHTML = matching.map((id) => {
        const token = config(id);
        return `
          <label class="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border ${selection.methodId === id ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-black/25'} p-4 hover:border-accent/30">
            <div><div class="font-semibold text-white">${escapeHtml(symbol(token) || token?.label || id)}</div><div class="mt-1 text-xs text-soft">${escapeHtml(token?.label || networkName(id))}</div></div>
            <div class="flex items-center gap-2">${stable(token) ? '<span class="rounded-full bg-accent/10 px-2 py-1 text-[10px] uppercase tracking-wider text-accent">Stable</span>' : ''}<input type="radio" name="nekopayAsset" value="${id}" ${selection.methodId === id ? 'checked' : ''} class="h-4 w-4 accent-[#7ddc5b]" /></div>
          </label>`;
      }).join('');
      tokenList.querySelectorAll('input[name="nekopayAsset"]').forEach((radio) => radio.addEventListener('change', () => {
        selection.methodId = radio.value;
        renderTokens();
      }));
    };

    networkSelect.addEventListener('change', renderTokens);
    renderTokens();

    body.querySelector('#nekopayAssetContinue').addEventListener('click', async () => {
      const status = body.querySelector('#nekopayAssetStatus');
      const payerInput = body.querySelector('#nekopayPayerAccount');
      if (payerInput) {
        selection.payerAccount = payerInput.value.trim();
        if (!selection.payerAccount) {
          status.textContent = 'Enter the account name that your Keychain wallet will send from.';
          return;
        }
      }
      if (!selection.methodId) {
        status.textContent = 'Choose a token or crypto asset.';
        return;
      }
      if (selection.wallet?.family === 'evm') {
        try {
          await switchEvmNetwork(selection.provider, selection.methodId);
        } catch (error) {
          status.textContent = error.message;
          return;
        }
      }
      selection.ready = true;
      state.latestSelection = selection;
      updateCompactSelection(form, selection);
      closeModal();
    });
  }

  function updateCompactSelection(form, selection) {
    const panel = form.querySelector('[data-nekopay-wallet-selection]');
    if (!panel) return;
    const token = config(selection.methodId);
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] text-soft">Crypto wallet</div>
          <div class="mt-1 font-semibold text-white">${escapeHtml(selection.wallet?.name || 'Wallet')} · ${escapeHtml(networkName(selection.methodId))} · ${escapeHtml(symbol(token))}</div>
          <div class="mt-1 text-xs text-soft">${selection.account ? `Connected ${escapeHtml(shortAddress(selection.account))}` : selection.payerAccount ? `From @${escapeHtml(selection.payerAccount)}` : 'QR / local wallet'}</div>
        </div>
        <button type="button" data-nekopay-change-wallet class="rounded-xl border border-white/10 px-3 py-2 text-sm text-accent">Change</button>
      </div>`;
    panel.querySelector('[data-nekopay-change-wallet]').addEventListener('click', () => {
      openModal();
      renderWalletList(form, selection);
    });
  }

  function enhanceForm(form) {
    if (!form || form.dataset.nekopayWalletEnhanced === '1' || !state.bootstrap) return;
    const radios = [...form.querySelectorAll('input[type="radio"][name="methodId"]')];
    if (!radios.length) return;
    const cryptoRadios = radios.filter((radio) => Boolean(config(radio.value)));
    if (!cryptoRadios.length) return;

    const methodGrid = cryptoRadios[0].closest('label')?.parentElement;
    if (!methodGrid) return;

    const originallyCheckedCrypto = cryptoRadios.find((radio) => radio.checked)?.value || null;
    const selection = {
      form,
      methods: cryptoRadios.map((radio) => radio.value),
      methodId: originallyCheckedCrypto || cryptoRadios[0].value,
      wallet: null,
      provider: null,
      account: null,
      payerAccount: '',
      ready: false
    };
    state.forms.set(form, selection);
    form.dataset.nekopayWalletEnhanced = '1';

    cryptoRadios.forEach((radio) => {
      const label = radio.closest('label');
      if (label) label.classList.add('hidden');
      radio.checked = false;
    });

    const card = document.createElement('label');
    card.className = 'cursor-pointer rounded-2xl border border-white/10 bg-black/30 p-4 text-center hover:border-accent/30';
    card.innerHTML = `
      <input type="radio" name="nekopayWalletDisplay" value="crypto-wallet" class="mb-3 h-4 w-4 accent-[#7ddc5b]" />
      <div class="font-medium text-white">Crypto Wallet</div>
      <div class="mt-1 text-xs text-soft">Choose wallet + token</div>`;
    methodGrid.appendChild(card);
    const displayRadio = card.querySelector('input');

    const summary = document.createElement('div');
    summary.dataset.nekopayWalletSelection = '1';
    summary.className = 'hidden rounded-[1.5rem] border border-accent/20 bg-accent/5 p-4';
    methodGrid.insertAdjacentElement('afterend', summary);

    const selectCrypto = () => {
      displayRadio.checked = true;
      radios.forEach((radio) => { radio.checked = false; });
      openModal();
      if (selection.ready) renderAssetPicker(form, selection);
      else renderWalletList(form, selection);
    };
    card.addEventListener('click', selectCrypto);

    radios.filter((radio) => !cryptoRadios.includes(radio)).forEach((radio) => radio.addEventListener('change', () => {
      if (radio.checked) displayRadio.checked = false;
    }));

    form.addEventListener('submit', (event) => {
      if (!displayRadio.checked && !originallyCheckedCrypto) return;
      if (!displayRadio.checked && originallyCheckedCrypto) displayRadio.checked = true;
      if (!selection.ready) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openModal();
        renderWalletList(form, selection);
        return;
      }
      const target = cryptoRadios.find((radio) => radio.value === selection.methodId);
      if (!target) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      radios.forEach((radio) => { radio.checked = false; });
      target.checked = true;
      state.latestSelection = selection;
    }, true);

    if (originallyCheckedCrypto) displayRadio.checked = true;
  }

  function paymentFromJson(data) {
    if (data?.instructions?.address) return data;
    if (data?.paymentAttempt?.instructions?.address) return data.paymentAttempt;
    if (data?.payment?.instructions?.address) return data.payment;
    return null;
  }

  async function inspectResponse(response) {
    try {
      if (!response.ok || !String(response.headers.get('content-type') || '').includes('application/json')) return;
      const data = await response.clone().json();
      const payment = paymentFromJson(data);
      if (!payment) return;
      state.latestPayment = payment;
      queueMicrotask(renderLatestPayment);
    } catch (_) {}
  }

  window.fetch = async (...args) => {
    const response = await rawFetch(...args);
    inspectResponse(response);
    return response;
  };

  function buildEip681(payment, methodId) {
    const instructions = payment.instructions || {};
    const token = config(methodId);
    const chain = evmNetworks[networkName(methodId, token)];
    if (!chain) return null;
    const units = decimalToUnits(instructions.amount, Number(token?.decimals ?? 18));
    const contract = String(instructions.contract || token?.contract || '');
    if (contract) return `ethereum:${contract}@${chain.chainIdDecimal}/transfer?address=${instructions.address}&uint256=${units}`;
    return `ethereum:${instructions.address}@${chain.chainIdDecimal}?value=${units}`;
  }

  function qrPayload(payment, methodId) {
    const instructions = payment.instructions || {};
    const token = config(methodId);
    if (instructions.url) return instructions.url;
    if (token?.chainType === 'evm') {
      try { return buildEip681(payment, methodId); } catch (_) {}
    }
    return [
      'NekoPay payment',
      `Network: ${instructions.network || networkName(methodId)}`,
      `Address: ${instructions.address || ''}`,
      `Amount: ${instructions.amount || ''} ${instructions.currency || symbol(token)}`,
      instructions.contract ? `Token contract: ${instructions.contract}` : null,
      instructions.memo ? `Memo: ${instructions.memo}` : null
    ].filter(Boolean).join('\n');
  }

  function padHex(value, length) {
    return String(value).replace(/^0x/, '').toLowerCase().padStart(length, '0');
  }

  async function payEvm(payment, methodId, selection, statusNode) {
    const provider = selection?.provider || evmProvider(selection?.wallet?.id || 'metamask');
    if (!provider?.request) throw new Error('Connected EVM wallet is no longer available');
    const token = config(methodId);
    const instructions = payment.instructions || {};
    const account = selection?.account;
    if (!account) throw new Error('Reconnect your wallet first');
    await switchEvmNetwork(provider, methodId);
    const units = decimalToUnits(instructions.amount, Number(token?.decimals ?? 18));
    const contract = String(instructions.contract || token?.contract || '');
    const tx = { from: account };
    if (contract) {
      tx.to = contract;
      tx.data = `0xa9059cbb${padHex(instructions.address, 64)}${padHex(units.toString(16), 64)}`;
    } else {
      tx.to = instructions.address;
      tx.value = `0x${units.toString(16)}`;
    }
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
    statusNode.textContent = `Transaction submitted ${shortAddress(hash)}. NekoPay is verifying it on-chain.`;
  }

  function payKeychain(payment, methodId, selection, statusNode) {
    return new Promise((resolve, reject) => {
      const wallet = selection?.wallet;
      const keychain = keychainFor(wallet?.id);
      if (!keychain?.requestTransfer) return reject(new Error(`${wallet?.name || 'Keychain'} is not available; use the QR/manual details instead.`));
      if (!selection?.payerAccount) return reject(new Error('Your sending account is missing; reopen Change wallet and enter it.'));
      const instructions = payment.instructions || {};
      const currency = instructions.currency || symbol(config(methodId));
      keychain.requestTransfer(
        selection.payerAccount,
        instructions.address,
        String(instructions.amount),
        instructions.memo || '',
        currency,
        (result) => {
          if (result?.success) {
            statusNode.textContent = 'Transfer submitted. NekoPay is verifying the transaction on-chain.';
            resolve(result);
          } else reject(new Error(result?.message || result?.error || 'Wallet declined the transfer'));
        }
      );
    });
  }

  function renderPaymentCard(container, payment) {
    if (!container || !payment?.instructions?.address) return;
    const methodId = payment.methodId || state.latestSelection?.methodId;
    const token = config(methodId);
    if (!token) return;
    const instructions = payment.instructions;
    const fingerprint = `${methodId}|${instructions.address}|${instructions.amount}|${instructions.contract || ''}`;
    const old = container.querySelector('[data-nekopay-payment-card]');
    if (old?.dataset.fingerprint === fingerprint) return;
    if (old) old.remove();

    const selection = state.latestSelection;
    const card = document.createElement('div');
    card.dataset.nekopayPaymentCard = '1';
    card.dataset.fingerprint = fingerprint;
    card.className = 'mt-5 overflow-hidden rounded-[1.75rem] border border-accent/20 bg-[#101612]';
    card.innerHTML = `
      <div class="border-b border-white/10 p-5">
        <div class="text-xs uppercase tracking-[0.25em] text-soft">Amount due</div>
        <div class="mt-2 text-3xl font-bold text-white">${escapeHtml(instructions.amount)} ${escapeHtml(instructions.currency || symbol(token))}</div>
        <div class="mt-1 text-sm text-soft">${escapeHtml(instructions.network || networkName(methodId))} · ${escapeHtml(token.label || symbol(token))}</div>
      </div>
      <div class="grid gap-5 p-5 md:grid-cols-[190px_1fr]">
        <div class="rounded-2xl bg-white p-3"><img data-nekopay-payment-qr class="h-auto w-full" width="190" height="190" alt="Wallet payment QR" /></div>
        <div class="grid content-start gap-3">
          <div class="rounded-2xl border border-white/10 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-[0.2em] text-soft">Send to</div><div class="mt-1 break-all text-sm text-white">${escapeHtml(instructions.address)}</div></div>
          ${instructions.memo ? `<div class="rounded-2xl border border-white/10 bg-black/25 p-3"><div class="text-[10px] uppercase tracking-[0.2em] text-soft">Memo</div><div class="mt-1 break-all text-sm text-white">${escapeHtml(instructions.memo)}</div></div>` : ''}
          <div data-nekopay-pay-actions class="flex flex-wrap gap-2"></div>
          <div data-nekopay-wallet-pay-status class="text-xs leading-5 text-accent">After sending, NekoPay automatically checks the blockchain and waits for the required confirmations.</div>
          <div class="text-xs leading-5 text-soft">Always confirm the network, token, amount and receiving address inside your wallet before approving.</div>
        </div>
      </div>`;
    card.querySelector('[data-nekopay-payment-qr]').src = `/api/public/wallet/qr?data=${encodeURIComponent(qrPayload(payment, methodId))}`;

    const actions = card.querySelector('[data-nekopay-pay-actions]');
    const statusNode = card.querySelector('[data-nekopay-wallet-pay-status]');
    const makeButton = (label, primary, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'rounded-xl bg-accent px-4 py-2 font-semibold text-black' : 'rounded-xl border border-white/10 px-3 py-2 text-sm text-soft hover:text-white';
      button.textContent = label;
      button.addEventListener('click', handler);
      actions.appendChild(button);
      return button;
    };

    if (token.chainType === 'evm' && selection?.wallet?.family === 'evm') {
      const button = makeButton(`Pay with ${selection.wallet.name}`, true, async () => {
        button.disabled = true;
        statusNode.textContent = `Opening ${selection.wallet.name}…`;
        try { await payEvm(payment, methodId, selection, statusNode); button.textContent = 'Transaction submitted'; }
        catch (error) { statusNode.textContent = error.message; button.disabled = false; }
      });
    } else if (['Hive', 'Steem', 'Blurt'].includes(networkName(methodId)) && ['hive', 'steem', 'blurt'].includes(selection?.wallet?.family)) {
      const button = makeButton(`Pay with ${selection.wallet.name}`, true, async () => {
        button.disabled = true;
        statusNode.textContent = `Opening ${selection.wallet.name}…`;
        try { await payKeychain(payment, methodId, selection, statusNode); button.textContent = 'Transfer submitted'; }
        catch (error) { statusNode.textContent = error.message; button.disabled = false; }
      });
    } else if (token.chainType === 'solana' && instructions.url) {
      makeButton(selection?.wallet?.id === 'phantom' ? 'Open Phantom' : 'Open wallet', true, () => { window.location.href = instructions.url; });
    }

    makeButton('Copy address', false, async (event) => {
      await navigator.clipboard.writeText(instructions.address);
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = 'Copy address'; }, 1200);
    });
    makeButton('Copy amount', false, async (event) => {
      await navigator.clipboard.writeText(String(instructions.amount));
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = 'Copy amount'; }, 1200);
    });
    container.appendChild(card);
  }

  function renderLatestPayment() {
    if (!state.latestPayment) return;
    ['checkoutMessage', 'hostedPayMessage'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) renderPaymentCard(node, state.latestPayment);
    });
  }

  function enhance() {
    enhanceForm(document.getElementById('checkoutForm'));
    enhanceForm(document.getElementById('hostedCheckoutPayForm'));
    renderLatestPayment();
  }

  async function boot() {
    try {
      const response = await rawFetch('/api/bootstrap', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      state.bootstrap = await response.json();
    } catch (_) { return; }
    enhance();
    new MutationObserver(enhance).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  }

  boot();
})();
