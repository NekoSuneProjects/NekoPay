const defaultTaxRate = Number(process.env.STORE_TAX_RATE || 0.2);
const platformName = process.env.PLATFORM_NAME || 'NekoPay';
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const supportedCurrencies = [
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
  'JPY'
];

const supportedTokens = {
  hive: { symbol: 'hive', label: 'Hive', memo: true, decimals: 3 },
  hbd: { symbol: 'hbd', label: 'Hive Dollar', memo: true, decimals: 3 },
  steem: { symbol: 'steem', label: 'Steem', memo: true, decimals: 3 },
  sbd: { symbol: 'sbd', label: 'Steem Dollars', memo: true, decimals: 3 },
  blurt: { symbol: 'blurt', label: 'Blurt', memo: true, decimals: 3 },
  eth: {
    enabled: false,
    symbol: 'eth',
    label: 'Ethereum',
    memo: false,
    decimals: 18,
    walletKey: 'ethAddress',
    chainType: 'evm',
    network: 'Ethereum',
    priceId: 'ethereum',
    invoiceSymbol: 'ETH',
    note: 'Native ETH',
    url: 'https://eth1.trezor.io/api',
    altExplorerUrls: ['https://eth2.trezor.io/api']
  },
  pol: {
    enabled: false,
    symbol: 'pol',
    label: 'Polygon',
    memo: false,
    decimals: 18,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'matic-network',
    invoiceSymbol: 'POL',
    note: 'Native Polygon',
    url: 'https://maticbook.guarda.com/api',
    altExplorerUrls: ['https://pol1.trezor.io/api', 'https://pol2.trezor.io/api']
  },
  bnb: {
    enabled: false,
    symbol: 'bnb',
    label: 'BNB Chain',
    memo: false,
    decimals: 18,
    walletKey: 'bnbAddress',
    chainType: 'evm',
    network: 'BNB Chain',
    priceId: 'binancecoin',
    invoiceSymbol: 'BNB',
    note: 'Native BNB',
    url: 'https://bsc1.trezor.io/api',
    altExplorerUrls: ['https://bsc2.trezor.io/api']
  },
  myst: {
    enabled: false,
    symbol: 'myst',
    label: 'Mysterium',
    memo: false,
    decimals: 18,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'mysterium',
    invoiceSymbol: 'MYST',
    contract: '0x1379E8886A944d2D9d440b3d88DF536Aea08d9F3',
    note: 'ERC20 on Polygon',
    url: 'https://maticbook.guarda.com/api',
    altExplorerUrls: ['https://pol1.trezor.io/api', 'https://pol2.trezor.io/api']
  },
  usdt_pol: {
    enabled: false,
    symbol: 'usdt_pol',
    label: 'USDT Polygon',
    memo: false,
    decimals: 6,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'tether',
    invoiceSymbol: 'USDT',
    contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    note: 'USDT on Polygon',
    url: 'https://maticbook.guarda.com/api',
    altExplorerUrls: ['https://pol1.trezor.io/api', 'https://pol2.trezor.io/api']
  },
  usdc_pol: {
    enabled: false,
    symbol: 'usdc_pol',
    label: 'USDC Polygon',
    memo: false,
    decimals: 6,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'usd-coin',
    invoiceSymbol: 'USDC',
    contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    note: 'USDC on Polygon',
    url: 'https://maticbook.guarda.com/api',
    altExplorerUrls: ['https://pol1.trezor.io/api', 'https://pol2.trezor.io/api']
  },
  usdt_eth: {
    enabled: false,
    symbol: 'usdt_eth',
    label: 'USDT Ethereum',
    memo: false,
    decimals: 6,
    walletKey: 'ethAddress',
    chainType: 'evm',
    network: 'Ethereum',
    priceId: 'tether',
    invoiceSymbol: 'USDT',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    note: 'USDT on Ethereum',
    url: 'https://eth1.trezor.io/api',
    altExplorerUrls: ['https://eth2.trezor.io/api']
  },
  usdc_eth: {
    enabled: false,
    symbol: 'usdc_eth',
    label: 'USDC Ethereum',
    memo: false,
    decimals: 6,
    walletKey: 'ethAddress',
    chainType: 'evm',
    network: 'Ethereum',
    priceId: 'usd-coin',
    invoiceSymbol: 'USDC',
    contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    note: 'USDC on Ethereum',
    url: 'https://eth1.trezor.io/api',
    altExplorerUrls: ['https://eth2.trezor.io/api']
  },
  usdt_bnb: {
    enabled: false,
    symbol: 'usdt_bnb',
    label: 'USDT BNB Chain',
    memo: false,
    decimals: 18,
    walletKey: 'bnbAddress',
    chainType: 'evm',
    network: 'BNB Chain',
    priceId: 'tether',
    invoiceSymbol: 'USDT',
    contract: '0x55d398326f99059ff775485246999027b3197955',
    note: 'USDT on BNB Chain',
    url: 'https://bsc1.trezor.io/api',
    altExplorerUrls: ['https://bsc2.trezor.io/api']
  },
  usdc_bnb: {
    enabled: false,
    symbol: 'usdc_bnb',
    label: 'USDC BNB Chain',
    memo: false,
    decimals: 18,
    walletKey: 'bnbAddress',
    chainType: 'evm',
    network: 'BNB Chain',
    priceId: 'usd-coin',
    invoiceSymbol: 'USDC',
    contract: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    note: 'USDC on BNB Chain',
    url: 'https://bsc1.trezor.io/api',
    altExplorerUrls: ['https://bsc2.trezor.io/api']
  },
  sol: {
    symbol: 'sol',
    label: 'Solana',
    memo: false,
    decimals: 9,
    walletKey: 'solAddress',
    chainType: 'solana',
    network: 'Solana',
    priceId: 'solana',
    invoiceSymbol: 'SOL',
    note: 'Native SOL',
    minimumConfirmations: 1,
    url: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    altExplorerUrls: ['https://solana-rpc.publicnode.com']
  },
  usdc_sol: {
    symbol: 'usdc_sol',
    label: 'USDC Solana',
    memo: false,
    decimals: 6,
    walletKey: 'solAddress',
    chainType: 'solana',
    network: 'Solana',
    priceId: 'usd-coin',
    invoiceSymbol: 'USDC',
    contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    note: 'USDC (SPL) on Solana',
    minimumConfirmations: 1,
    url: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    altExplorerUrls: ['https://solana-rpc.publicnode.com']
  },
  usdt_sol: {
    symbol: 'usdt_sol',
    label: 'USDT Solana',
    memo: false,
    decimals: 6,
    walletKey: 'solAddress',
    chainType: 'solana',
    network: 'Solana',
    priceId: 'tether',
    invoiceSymbol: 'USDT',
    contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    note: 'USDT (SPL) on Solana',
    minimumConfirmations: 1,
    url: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    altExplorerUrls: ['https://solana-rpc.publicnode.com']
  },
  tlos: { symbol: 'tlos', label: 'Telos', memo: true, decimals: 4 },
  eos: { symbol: 'eos', label: 'EOS', memo: true, decimals: 4 },
  wax: { symbol: 'wax', label: 'WAX', memo: true, decimals: 8 },
  fio: { symbol: 'fio', label: 'FIO', memo: true, decimals: 9, walletKey: 'fioPublicKey' },
  pivx: { symbol: 'pivx', label: 'PIVX', memo: false, decimals: 8 },
  fls: { symbol: 'fls', label: 'FLS', memo: false, decimals: 8 }
};


// Direct-chain methods. Existing EVM entries above were previously kept disabled while
// NekoPay depended on unreliable explorer APIs. The verifier now uses the RPC backend pool,
// so ETH / Polygon / BNB direct payments and their token transfers can be enabled safely.
Object.assign(supportedTokens, {
  usdc_e_pol: {
    enabled: true,
    symbol: 'usdc_e_pol',
    label: 'USDC.e Polygon (bridged)',
    memo: false,
    decimals: 6,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'usd-coin',
    invoiceSymbol: 'USDC.e',
    contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    note: 'Legacy bridged USDC.e on Polygon'
  },
  dai_eth: {
    enabled: true,
    symbol: 'dai_eth',
    label: 'DAI Ethereum',
    memo: false,
    decimals: 18,
    walletKey: 'ethAddress',
    chainType: 'evm',
    network: 'Ethereum',
    priceId: 'dai',
    invoiceSymbol: 'DAI',
    contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    note: 'DAI on Ethereum'
  },
  dai_pol: {
    enabled: true,
    symbol: 'dai_pol',
    label: 'DAI Polygon',
    memo: false,
    decimals: 18,
    walletKey: 'polAddress',
    chainType: 'evm',
    network: 'Polygon',
    priceId: 'dai',
    invoiceSymbol: 'DAI',
    contract: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    note: 'PoS DAI on Polygon'
  },
  trx: {
    enabled: true,
    symbol: 'trx',
    label: 'TRON',
    memo: false,
    decimals: 6,
    walletKey: 'trxAddress',
    chainType: 'tron',
    network: 'TRON',
    priceId: 'tron',
    invoiceSymbol: 'TRX',
    note: 'Native TRX',
    minimumConfirmations: 1
  },
  usdt_trx: {
    enabled: true,
    symbol: 'usdt_trx',
    label: 'USDT TRON (TRC-20)',
    memo: false,
    decimals: 6,
    walletKey: 'trxAddress',
    chainType: 'tron',
    network: 'TRON',
    priceId: 'tether',
    invoiceSymbol: 'USDT',
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    note: 'Official Tether USDt on TRON (TRC-20)',
    minimumConfirmations: 1
  },
  tusd_trx: {
    enabled: true,
    symbol: 'tusd_trx',
    label: 'TUSD TRON (TRC-20)',
    memo: false,
    decimals: 18,
    walletKey: 'trxAddress',
    chainType: 'tron',
    network: 'TRON',
    priceId: 'true-usd',
    invoiceSymbol: 'TUSD',
    contract: 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4',
    note: 'TrueUSD on TRON (TRC-20)',
    minimumConfirmations: 1
  }
});

for (const tokenId of [
  'eth', 'pol', 'bnb', 'myst',
  'usdt_pol', 'usdc_pol', 'usdt_eth', 'usdc_eth', 'usdt_bnb', 'usdc_bnb'
]) {
  supportedTokens[tokenId].enabled = true;
}

// Circle native USDC on Polygon. Keep the old bridged 0x2791... token separately as
// usdc_e_pol so existing Polygon users can still intentionally select USDC.e.
Object.assign(supportedTokens.usdc_pol, {
  label: 'USDC Polygon (native)',
  contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  note: 'Native Circle USDC on Polygon'
});

Object.assign(supportedTokens.usdt_bnb, {
  label: 'Binance-Peg USDT (BNB Chain)',
  note: 'Binance-Peg USDT on BNB Chain'
});
Object.assign(supportedTokens.usdc_bnb, {
  label: 'Binance-Peg USDC (BNB Chain)',
  note: 'Binance-Peg USDC on BNB Chain'
});

for (const tokenId of ['eth', 'usdt_eth', 'usdc_eth', 'dai_eth']) {
  supportedTokens[tokenId].minimumConfirmations = 12;
}
for (const tokenId of ['pol', 'myst', 'usdt_pol', 'usdc_pol', 'usdc_e_pol', 'dai_pol']) {
  supportedTokens[tokenId].minimumConfirmations = 20;
}
for (const tokenId of ['bnb', 'usdt_bnb', 'usdc_bnb']) {
  supportedTokens[tokenId].minimumConfirmations = 15;
}

const defaultProducts = [
  {
    id: 'starter-crates',
    name: '5 Crates',
    description: 'Starter bundle for your server or world.',
    price: 3.99
  },
  {
    id: 'crate-bundle',
    name: '10 Crates',
    description: 'Upsell bundle for repeat buyers.',
    price: 6.99
  },
  {
    id: 'shares-pack',
    name: '10 Silverbull Shares',
    description: 'Extra economy items for your game.',
    price: 8.99
  }
];

module.exports = {
  platformName,
  appBaseUrl,
  defaultTaxRate,
  supportedCurrencies,
  supportedTokens,
  defaultProducts
};
