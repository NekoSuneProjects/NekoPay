'use strict';

const modules = require('../compat/network-chain-modules');

const NETWORK_TO_SYMBOL = {
  ethereum: 'ETH',
  'ethereum classic': 'ETC',
  etc: 'ETC',
  'bnb chain': 'BSC',
  bsc: 'BSC',
  bnb: 'BSC',
  polygon: 'POL',
  pol: 'POL',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'BASE',
  avalanche: 'AVAX',
  'avalanche c-chain': 'AVAX',
  gnosis: 'GNO',
  cronos: 'CRO',
  linea: 'LINEA',
  scroll: 'SCROLL',
  blast: 'BLAST',
  zksync: 'ZKSYNC',
  'zksync era': 'ZKSYNC',
  opbnb: 'OPBNB',
  mantle: 'MNT',
  celo: 'CELO',
  sonic: 'SONIC',
  theta: 'THETA',
  bttc: 'BTTC',
  'bittorrent chain': 'BTTC'
};

function resolveNetworkSymbol(tokenConfig = {}) {
  const direct = String(tokenConfig.chainSymbol || tokenConfig.networkSymbol || '').trim().toUpperCase();
  if (direct && modules[`${direct}Module`]) return direct;
  const network = String(tokenConfig.network || '').trim().toLowerCase();
  if (NETWORK_TO_SYMBOL[network]) return NETWORK_TO_SYMBOL[network];

  const tokenSymbol = String(tokenConfig.symbol || '').toLowerCase();
  if (tokenSymbol.endsWith('_pol')) return 'POL';
  if (tokenSymbol.endsWith('_bnb') || tokenSymbol.endsWith('_bsc')) return 'BSC';
  if (tokenSymbol.endsWith('_eth')) return 'ETH';
  return 'ETH';
}

async function existsEvmTransaction(address, amount, createdAt, tokenConfig = {}, minimumConfirmations = 0) {
  const symbol = resolveNetworkSymbol(tokenConfig);
  const Module = modules[`${symbol}Module`];
  if (!Module) throw new Error(`NekoPay has no EVM verifier for ${symbol}`);

  const verifier = new Module({
    tokenContract: tokenConfig.contract || null,
    decimals: Number(tokenConfig.decimals ?? 18),
    url: tokenConfig.rpcUrl || tokenConfig.rpcURL || null
  });

  return verifier.existsTransaction(
    address,
    amount,
    createdAt ? new Date(createdAt).getTime() : 0,
    null,
    Number(minimumConfirmations || 0)
  );
}

module.exports = {
  existsEvmTransaction,
  resolveNetworkSymbol,
  NETWORK_TO_SYMBOL
};
