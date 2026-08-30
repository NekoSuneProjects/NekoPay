'use strict';

(() => {
  const walletState = {
    bootstrap: null,
    account: null,
    latestPayment: null,
    lastSelectedMethod: null,
    selectedByForm: new WeakMap()
  };

  const nativeNetworkNames = {
    hive: 'Hive',
    hbd: 'Hive',
    steem: 'Steem',
    sbd: 'Steem',
    blurt: 'Blurt',
    tlos: 'Telos',
    eos: 'EOS',
    fio: 'FIO',
    wax: 'WAX',
    pivx: 'PIVX',
    fls: 'FLS'
  };

  const networkPriority = [
    'Ethereum',
    'Polygon',
    'BNB Chain',
    'Solana',
    'Hive',
    'Steem',
    'Blurt',
    'Telos',
    'EOS',
    'FIO',
    'WAX',
    'PIVX',
    'FLS'
  ];

  const evmNetworks = {
    Ethereum: {
      chainId: '0x1',
      chainIdDecimal: 1,
      chainName: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-rpc.publicnode.com'],
      blockExplorerUrls: ['https://etherscan.io']
    },
    Polygon: {
      chainId: '0x89',
      chainIdDecimal: 137,
      chainName: 'Polygon',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
      blockExplorerUrls: ['https://polygonscan.com']
    },
    'BNB Chain': {
      chainId: '0x38',
      chainIdDecimal: 56,
      chainName: 'BNB Smart Chain',
      nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      rpcUrls: ['https://bsc-rpc.publicnode.com'],
      blockExplorerUrls: ['https://bscscan.com']
    }
  };

  const stableSymbols = new Set(['USDC', 'USDC.E', 'USDT', 'DAI', 'TUSD', 'PYUSD']);
  const rawFetch = window.fetch.bind(window);

  function shortAddress(value) {
    const address = String(value || '');
    if (address.length < 14) return address;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  function tokenConfig(methodId) {
    return walletState.bootstrap?.supportedTokens?.[String(methodId || '').toLowerCase()] || null;
  }

  function networkName(methodId, config = tokenConfig(methodId)) {
    if (config?.network) return config.network;
    return nativeNetworkNames[String(methodId || '').toLowerCase()] || config?.label || String(methodId || '').toUpperCase();
  }

  function tokenSymbol(config) {
    return String(config?.invoiceSymbol || config?.symbol || '').toUpperCase();
  }

  function isStablecoin(config) {
    return stableSymbols.has(tokenSymbol(config));
  }

  function sortNetworks(names) {
    return [...names].sort((a, b) => {
      const ai = networkPriority.indexOf(a);
      const bi = networkPriority.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }

  function decimalToUnits(value, decimals) {
    const raw = String(value ?? '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Invalid payment amount');
    const [wholePart, fractionPart = ''] = raw.split('.');
    const padded = (fractionPart + '0'.repeat(decimals)).slice(0, decimals);
    const whole = BigInt(wholePart || '0') * (10n ** BigInt(decimals));
    const fraction = BigInt(padded || '0');
    return whole + fraction;
  }

  function buildEip681(instructions, config) {
    const network = evmNetworks[networkName(walletState.lastSelectedMethod, config)];
    if (!network) return null;

    const amountUnits = decimalToUnits(instructions.amount, Number(config?.decimals ?? 18));
    const recipient = String(instructions.address || '').trim();
    const contract = String(instructions.contract || config?.contract || '').trim();

    if (contract) {
      return `ethereum:${contract}@${network.chainIdDecimal}/transfer?address=${recipient}&uint256=${amountUnits.toString()}`;
    }
    return `ethereum:${recipient}@${network.chainIdDecimal}?value=${amountUnits.toString()}`;
  }

  function buildQrPayload(payment, config) {
    const instructions = payment?.instructions || {};
    if (instructions.url) return instructions.url;

    if (config?.chainType === 'evm') {
      try {
        const uri = buildEip681(instructions, config);
        if (uri) return uri;
      } catch (_) {
        // Fall back to a readable payment payload below.
      }
    }

    return [
      'NekoPay payment',
      instructions.network ? `Network: ${instructions.network}` : null,
      instructions.address ? `Address: ${instructions.address}` : null,
      instructions.amount ? `Amount: ${instructions.amount} ${instructions.currency || ''}`.trim() : null,
      instructions.contract ? `Token contract: ${instructions.contract}` : null,
      instructions.memo ? `Memo: ${instructions.memo}` : null
    ].filter(Boolean).join('\n');
  }

  async function switchEvmNetwork(config) {
    if (!window.ethereum || config?.chainType !== 'evm') return;
    const network = evmNetworks[networkName(walletState.lastSelectedMethod, config)];
    if (!network) throw new Error('This EVM network is not configured for MetaMask yet');

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: network.chainId }]
      });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [network]
      });
    }
  }

  async function connectMetaMask(config, statusNode) {
    if (!window.ethereum?.request) {
      throw new Error('MetaMask was not detected. You can still pay by scanning the QR code after creating the payment.');
    }

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletState.account = accounts?.[0] || null;
    if (config?.chainType === 'evm') await switchEvmNetwork(config);

    document.querySelectorAll('[data-nekopay-wallet-account]').forEach((node) => {
      node.textContent = walletState.account ? `Connected: ${shortAddress(walletState.account)}` : 'Not connected';
    });
    if (statusNode) statusNode.textContent = walletState.account ? `MetaMask connected as ${shortAddress(walletState.account)}.` : 'MetaMask did not return an account.';
    return walletState.account;
  }

  function selectedMethodForForm(form) {
    return walletState.selectedByForm.get(form) || null;
  }

  function updateWalletChooser(form, cryptoMethods, networkSelect, tokenSelect, connectButton, accountNode, helperNode) {
    const selectedNetwork = networkSelect.value;
    const matching = cryptoMethods
      .filter((methodId) => networkName(methodId) === selectedNetwork)
      .sort((a, b) => {
        const aStable = isStablecoin(tokenConfig(a)) ? 0 : 1;
        const bStable = isStablecoin(tokenConfig(b)) ? 0 : 1;
        if (aStable !== bStable) return aStable - bStable;
        return String(tokenConfig(a)?.label || a).localeCompare(String(tokenConfig(b)?.label || b));
      });

    const previous = selectedMethodForForm(form);
    tokenSelect.replaceChildren();
    for (const methodId of matching) {
      const config = tokenConfig(methodId);
      const option = document.createElement('option');
      option.value = methodId;
      option.textContent = `${tokenSymbol(config) || config?.label || methodId}${isStablecoin(config) ? ' · Stablecoin' : ''}`;
      tokenSelect.appendChild(option);
    }

    if (matching.includes(previous)) tokenSelect.value = previous;
    else {
      const stable = matching.find((methodId) => isStablecoin(tokenConfig(methodId)));
      tokenSelect.value = stable || matching[0] || '';
    }

    const methodId = tokenSelect.value;
    const config = tokenConfig(methodId);
    walletState.selectedByForm.set(form, methodId);
    walletState.lastSelectedMethod = methodId;

    const evm = config?.chainType === 'evm';
    connectButton.hidden = !evm;
    connectButton.disabled = !evm;
    accountNode.hidden = !evm;
    accountNode.textContent = walletState.account ? `Connected: ${shortAddress(walletState.account)}` : 'Not connected';

    if (isStablecoin(config)) {
      helperNode.textContent = 'USD stablecoin selected. A US$1 checkout will normally quote close to 1 token; NekoPay calculates and locks the exact amount when the payment is created.';
    } else if (evm) {
      helperNode.textContent = 'Connect MetaMask now if you want. NekoPay calculates the exact crypto amount first, then MetaMask asks you to confirm the transaction.';
    } else {
      helperNode.textContent = 'Create the payment to get the exact amount, receiving address, memo if needed, and a QR code for your local/mobile wallet.';
    }
  }

  function enhanceCheckoutForm(form) {
    if (!form || form.dataset.nekopayWalletEnhanced === '1' || !walletState.bootstrap) return;

    const methodRadios = [...form.querySelectorAll('input[type="radio"][name="methodId"]')];
    if (!methodRadios.length) return;

    const cryptoRadios = methodRadios.filter((radio) => Boolean(tokenConfig(radio.value)));
    if (!cryptoRadios.length) return;

    const cryptoMethods = cryptoRadios.map((radio) => radio.value);
    const firstCryptoWasChecked = cryptoRadios.some((radio) => radio.checked);
    const methodGrid = cryptoRadios[0].closest('label')?.parentElement;
    if (!methodGrid) return;

    form.dataset.nekopayWalletEnhanced = '1';

    for (const radio of cryptoRadios) {
      const label = radio.closest('label');
      if (label) label.classList.add('hidden');
      radio.checked = false;
    }

    const walletCard = document.createElement('label');
    walletCard.className = 'rounded-2xl border border-white/10 bg-black/30 p-4 text-center cursor-pointer hover:border-accent/30';
    walletCard.innerHTML = `
      <input type="radio" name="nekopayWalletDisplay" value="local-wallet" class="mb-3 h-4 w-4 accent-[#7ddc5b]" />
      <div class="font-medium text-white">Crypto wallet</div>
      <div class="mt-1 text-xs text-soft">MetaMask or QR</div>
    `;
    methodGrid.appendChild(walletCard);

    const displayRadio = walletCard.querySelector('input');
    const panel = document.createElement('div');
    panel.className = 'hidden rounded-[1.5rem] border border-accent/20 bg-accent/5 p-5';
    panel.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="text-lg font-semibold text-white">Pay from your wallet</div>
          <div class="mt-1 text-sm text-soft">Choose a network and token instead of showing every token as a separate checkout button.</div>
        </div>
        <div class="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">Local wallet</div>
      </div>
      <div class="mt-5 grid gap-3 md:grid-cols-2">
        <label class="grid gap-2 text-sm text-soft">
          Network
          <select data-nekopay-wallet-network class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white"></select>
        </label>
        <label class="grid gap-2 text-sm text-soft">
          Token
          <select data-nekopay-wallet-token class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white"></select>
        </label>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" data-nekopay-connect-metamask class="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 font-semibold text-accent">Connect MetaMask</button>
        <span data-nekopay-wallet-account class="text-sm text-soft">Not connected</span>
      </div>
      <div data-nekopay-wallet-helper class="mt-3 text-xs leading-5 text-soft"></div>
      <div data-nekopay-wallet-status class="mt-2 text-xs text-accent"></div>
    `;
    methodGrid.insertAdjacentElement('afterend', panel);

    const networkSelect = panel.querySelector('[data-nekopay-wallet-network]');
    const tokenSelect = panel.querySelector('[data-nekopay-wallet-token]');
    const connectButton = panel.querySelector('[data-nekopay-connect-metamask]');
    const accountNode = panel.querySelector('[data-nekopay-wallet-account]');
    const helperNode = panel.querySelector('[data-nekopay-wallet-helper]');
    const statusNode = panel.querySelector('[data-nekopay-wallet-status]');

    const networks = sortNetworks(new Set(cryptoMethods.map((methodId) => networkName(methodId))));
    for (const name of networks) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      networkSelect.appendChild(option);
    }

    const initiallyCheckedCrypto = cryptoMethods[0];
    const initialNetwork = networkName(initiallyCheckedCrypto);
    if (networks.includes(initialNetwork)) networkSelect.value = initialNetwork;

    const chooseWallet = () => {
      displayRadio.checked = true;
      methodRadios.forEach((radio) => { radio.checked = false; });
      panel.classList.remove('hidden');
      const methodId = tokenSelect.value;
      walletState.selectedByForm.set(form, methodId);
      walletState.lastSelectedMethod = methodId;
    };

    walletCard.addEventListener('click', chooseWallet);
    displayRadio.addEventListener('change', chooseWallet);

    methodRadios.filter((radio) => !cryptoRadios.includes(radio)).forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        displayRadio.checked = false;
        panel.classList.add('hidden');
      });
    });

    networkSelect.addEventListener('change', () => {
      updateWalletChooser(form, cryptoMethods, networkSelect, tokenSelect, connectButton, accountNode, helperNode);
    });

    tokenSelect.addEventListener('change', () => {
      const methodId = tokenSelect.value;
      walletState.selectedByForm.set(form, methodId);
      walletState.lastSelectedMethod = methodId;
      updateWalletChooser(form, cryptoMethods, networkSelect, tokenSelect, connectButton, accountNode, helperNode);
    });

    connectButton.addEventListener('click', async () => {
      statusNode.textContent = '';
      try {
        const methodId = tokenSelect.value;
        walletState.lastSelectedMethod = methodId;
        await connectMetaMask(tokenConfig(methodId), statusNode);
      } catch (error) {
        statusNode.textContent = error.message;
      }
    });

    form.addEventListener('submit', (event) => {
      if (!displayRadio.checked) return;
      const methodId = tokenSelect.value;
      const target = cryptoRadios.find((radio) => radio.value === methodId);
      if (!target) {
        event.preventDefault();
        event.stopImmediatePropagation();
        statusNode.textContent = 'Choose a crypto token before continuing.';
        return;
      }
      methodRadios.forEach((radio) => { radio.checked = false; });
      target.checked = true;
      walletState.lastSelectedMethod = methodId;
      walletState.selectedByForm.set(form, methodId);
    }, true);

    updateWalletChooser(form, cryptoMethods, networkSelect, tokenSelect, connectButton, accountNode, helperNode);

    if (firstCryptoWasChecked) chooseWallet();
  }

  function extractPaymentPayload(data) {
    if (data?.instructions?.address) return data;
    if (data?.paymentAttempt?.instructions?.address) return data.paymentAttempt;
    if (data?.payment?.instructions?.address) return data.payment;
    return null;
  }

  async function inspectResponse(response) {
    try {
      if (!response.ok) return;
      const type = String(response.headers.get('content-type') || '');
      if (!type.includes('application/json')) return;
      const data = await response.clone().json();
      const payment = extractPaymentPayload(data);
      if (!payment) return;
      walletState.latestPayment = payment;
      if (payment.methodId) walletState.lastSelectedMethod = payment.methodId;
      queueMicrotask(renderLatestWalletPayment);
    } catch (_) {
      // Checkout continues normally if the enhancement cannot inspect a response.
    }
  }

  window.fetch = async (...args) => {
    const response = await rawFetch(...args);
    inspectResponse(response);
    return response;
  };

  function padHex(value, size) {
    return String(value).replace(/^0x/, '').toLowerCase().padStart(size, '0');
  }

  async function sendWithMetaMask(payment, config, statusNode) {
    if (!window.ethereum?.request) throw new Error('MetaMask was not detected');
    const instructions = payment?.instructions || {};
    const recipient = String(instructions.address || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) throw new Error('Invalid EVM receiving address');

    walletState.lastSelectedMethod = payment.methodId || walletState.lastSelectedMethod;
    const account = walletState.account || await connectMetaMask(config, statusNode);
    if (!account) throw new Error('Connect a MetaMask account first');
    await switchEvmNetwork(config);

    const amountUnits = decimalToUnits(instructions.amount, Number(config?.decimals ?? 18));
    const contract = String(instructions.contract || config?.contract || '').trim();
    const tx = { from: account };

    if (contract) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) throw new Error('Invalid token contract');
      tx.to = contract;
      tx.data = `0xa9059cbb${padHex(recipient, 64)}${padHex(amountUnits.toString(16), 64)}`;
    } else {
      tx.to = recipient;
      tx.value = `0x${amountUnits.toString(16)}`;
    }

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [tx]
    });
    statusNode.textContent = `Transaction submitted: ${txHash}`;
    return txHash;
  }

  function renderWalletPaymentActions(container, payment) {
    if (!container || !payment?.instructions?.address || !payment?.instructions?.amount) return;

    const instructions = payment.instructions;
    const methodId = payment.methodId || walletState.lastSelectedMethod;
    const config = tokenConfig(methodId);
    if (!config) return;

    const fingerprint = [methodId, instructions.address, instructions.amount, instructions.currency, instructions.contract].join('|');
    const existing = container.querySelector('[data-nekopay-local-wallet-payment]');
    if (existing?.dataset.fingerprint === fingerprint) return;
    if (existing) existing.remove();

    walletState.lastSelectedMethod = methodId;
    const qrPayload = buildQrPayload(payment, config);
    const card = document.createElement('div');
    card.dataset.nekopayLocalWalletPayment = '1';
    card.dataset.fingerprint = fingerprint;
    card.className = 'mt-5 rounded-[1.5rem] border border-accent/20 bg-accent/5 p-5';

    const heading = document.createElement('div');
    heading.className = 'text-lg font-semibold text-white';
    heading.textContent = 'Pay from your wallet';

    const summary = document.createElement('div');
    summary.className = 'mt-2 text-sm text-soft';
    summary.textContent = `Send exactly ${instructions.amount} ${instructions.currency || tokenSymbol(config)} on ${instructions.network || networkName(methodId, config)}.`;

    const layout = document.createElement('div');
    layout.className = 'mt-4 grid gap-5 md:grid-cols-[220px_1fr] md:items-start';

    const qrWrap = document.createElement('div');
    qrWrap.className = 'rounded-2xl bg-white p-3';
    const qr = document.createElement('img');
    qr.src = `/api/public/wallet/qr?data=${encodeURIComponent(qrPayload)}`;
    qr.alt = 'Payment QR code';
    qr.width = 220;
    qr.height = 220;
    qr.className = 'h-auto w-full';
    qrWrap.appendChild(qr);

    const details = document.createElement('div');
    details.className = 'grid gap-3 text-sm';

    const addressLine = document.createElement('div');
    addressLine.className = 'rounded-2xl border border-white/10 bg-black/30 p-3';
    addressLine.innerHTML = '<div class="text-xs uppercase tracking-[0.2em] text-soft">Receiving address</div>';
    const addressValue = document.createElement('div');
    addressValue.className = 'mt-1 break-all text-white';
    addressValue.textContent = instructions.address;
    addressLine.appendChild(addressValue);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'flex flex-wrap gap-2';

    const copyAddress = document.createElement('button');
    copyAddress.type = 'button';
    copyAddress.className = 'rounded-xl border border-white/10 px-3 py-2 text-soft hover:text-white';
    copyAddress.textContent = 'Copy address';
    copyAddress.addEventListener('click', async () => {
      await navigator.clipboard.writeText(instructions.address);
      copyAddress.textContent = 'Copied';
      setTimeout(() => { copyAddress.textContent = 'Copy address'; }, 1200);
    });

    const copyAmount = document.createElement('button');
    copyAmount.type = 'button';
    copyAmount.className = 'rounded-xl border border-white/10 px-3 py-2 text-soft hover:text-white';
    copyAmount.textContent = 'Copy amount';
    copyAmount.addEventListener('click', async () => {
      await navigator.clipboard.writeText(String(instructions.amount));
      copyAmount.textContent = 'Copied';
      setTimeout(() => { copyAmount.textContent = 'Copy amount'; }, 1200);
    });

    buttonRow.append(copyAddress, copyAmount);

    const walletStatus = document.createElement('div');
    walletStatus.className = 'text-xs text-accent';

    if (config.chainType === 'evm') {
      const metamask = document.createElement('button');
      metamask.type = 'button';
      metamask.className = 'rounded-xl bg-accent px-4 py-2 font-semibold text-black';
      metamask.textContent = walletState.account ? 'Pay with MetaMask' : 'Connect & pay with MetaMask';
      metamask.addEventListener('click', async () => {
        metamask.disabled = true;
        walletStatus.textContent = 'Opening MetaMask…';
        try {
          await sendWithMetaMask(payment, config, walletStatus);
          metamask.textContent = 'Transaction submitted';
        } catch (error) {
          walletStatus.textContent = error.message;
          metamask.disabled = false;
        }
      });
      buttonRow.prepend(metamask);
    }

    const qrHelp = document.createElement('div');
    qrHelp.className = 'text-xs leading-5 text-soft';
    qrHelp.textContent = config.chainType === 'evm'
      ? 'Scan the QR with a compatible mobile wallet, or use MetaMask above. Always confirm the network, token, amount and receiving address in your wallet before approving.'
      : 'Scan the QR with your mobile/local wallet. Check the amount, address and memo before sending.';

    details.append(addressLine, buttonRow, walletStatus, qrHelp);
    layout.append(qrWrap, details);
    card.append(heading, summary, layout);
    container.appendChild(card);
  }

  function renderLatestWalletPayment() {
    if (!walletState.latestPayment) return;
    for (const id of ['checkoutMessage', 'hostedPayMessage']) {
      const container = document.getElementById(id);
      if (container) renderWalletPaymentActions(container, walletState.latestPayment);
    }
  }

  function enhanceVisibleCheckout() {
    enhanceCheckoutForm(document.getElementById('checkoutForm'));
    enhanceCheckoutForm(document.getElementById('hostedCheckoutPayForm'));
    renderLatestWalletPayment();
  }

  async function boot() {
    try {
      const response = await rawFetch('/api/bootstrap', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      walletState.bootstrap = await response.json();
    } catch (_) {
      return;
    }

    enhanceVisibleCheckout();
    const observer = new MutationObserver(() => enhanceVisibleCheckout());
    observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });

    if (window.ethereum?.on) {
      window.ethereum.on('accountsChanged', (accounts) => {
        walletState.account = accounts?.[0] || null;
        document.querySelectorAll('[data-nekopay-wallet-account]').forEach((node) => {
          node.textContent = walletState.account ? `Connected: ${shortAddress(walletState.account)}` : 'Not connected';
        });
      });
    }
  }

  boot();
})();
