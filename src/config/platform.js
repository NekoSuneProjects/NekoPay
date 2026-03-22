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
    url: 'https://pol1.trezor.io/api',
    altExplorerUrls: ['https://pol2.trezor.io/api']
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
    url: 'https://pol1.trezor.io/api',
    altExplorerUrls: ['https://pol2.trezor.io/api']
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
    url: 'https://pol1.trezor.io/api',
    altExplorerUrls: ['https://pol2.trezor.io/api']
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
    url: 'https://pol1.trezor.io/api',
    altExplorerUrls: ['https://pol2.trezor.io/api']
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
  tlos: { symbol: 'tlos', label: 'Telos', memo: true, decimals: 4 },
  eos: { symbol: 'eos', label: 'EOS', memo: true, decimals: 4 },
  wax: { symbol: 'wax', label: 'WAX', memo: true, decimals: 8 },
  fio: { symbol: 'fio', label: 'FIO', memo: true, decimals: 9, walletKey: 'fioPublicKey' },
  pivx: { symbol: 'pivx', label: 'PIVX', memo: false, decimals: 8 },
  fls: { symbol: 'fls', label: 'FLS', memo: false, decimals: 8 }
};

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
