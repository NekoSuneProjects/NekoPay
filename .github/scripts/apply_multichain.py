from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, value):
    (ROOT / path).write_text(value, encoding='utf-8')


def replace_exact(path, old, new, expected=1):
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{path}: expected {expected} matches, found {count} for {old[:80]!r}')
    write(path, text.replace(old, new))


# ---- Token catalog ---------------------------------------------------------
platform_config_marker = "\nconst defaultProducts = ["
platform_config_block = r'''

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
'''
replace_exact('src/config/platform.js', platform_config_marker, platform_config_block + platform_config_marker)


# ---- Platform payment service ---------------------------------------------
replace_exact(
    'src/services/platform.js',
    "const { existsEvmTransaction } = require('./evm');\n",
    "const { existsEvmTransaction } = require('./evm');\nconst { existsTronTransaction } = require('./tron');\n"
)

replace_exact(
    'src/services/platform.js',
    "function isEvmMethod(methodId) {\n  return getTokenConfig(methodId)?.chainType === 'evm';\n}\n\nfunction isSolanaMethod(methodId) {",
    "function isEvmMethod(methodId) {\n  return getTokenConfig(methodId)?.chainType === 'evm';\n}\n\nfunction isTronMethod(methodId) {\n  return getTokenConfig(methodId)?.chainType === 'tron';\n}\n\nfunction isSolanaMethod(methodId) {"
)

replace_exact(
    'src/services/platform.js',
    "      bnbAddress: store.wallets?.bnbAddress || '',\n      solAddress: store.wallets?.solAddress || '',",
    "      bnbAddress: store.wallets?.bnbAddress || '',\n      trxAddress: store.wallets?.trxAddress || '',\n      solAddress: store.wallets?.solAddress || '',",
    expected=2
)
replace_exact(
    'src/services/platform.js',
    "    bnbAddress: input.bnbAddress || '',\n    solAddress: input.solAddress || '',",
    "    bnbAddress: input.bnbAddress || '',\n    trxAddress: input.trxAddress || '',\n    solAddress: input.solAddress || '',"
)
replace_exact(
    'src/services/platform.js',
    "    bnbAddress: payload.wallets?.bnbAddress ?? store.wallets?.bnbAddress ?? '',\n    solAddress: payload.wallets?.solAddress ?? store.wallets?.solAddress ?? '',",
    "    bnbAddress: payload.wallets?.bnbAddress ?? store.wallets?.bnbAddress ?? '',\n    trxAddress: payload.wallets?.trxAddress ?? store.wallets?.trxAddress ?? '',\n    solAddress: payload.wallets?.solAddress ?? store.wallets?.solAddress ?? '',"
)

replace_exact(
    'src/services/platform.js',
    "    usdc_bnb: Boolean(getTokenConfig('usdc_bnb') && wallets.bnbAddress),\n    sol: Boolean(getTokenConfig('sol') && wallets.solAddress),",
    "    usdc_bnb: Boolean(getTokenConfig('usdc_bnb') && wallets.bnbAddress),\n    dai_eth: Boolean(getTokenConfig('dai_eth') && wallets.ethAddress),\n    dai_pol: Boolean(getTokenConfig('dai_pol') && wallets.polAddress),\n    usdc_e_pol: Boolean(getTokenConfig('usdc_e_pol') && wallets.polAddress),\n    trx: Boolean(getTokenConfig('trx') && wallets.trxAddress),\n    usdt_trx: Boolean(getTokenConfig('usdt_trx') && wallets.trxAddress),\n    tusd_trx: Boolean(getTokenConfig('tusd_trx') && wallets.trxAddress),\n    sol: Boolean(getTokenConfig('sol') && wallets.solAddress),"
)

replace_exact(
    'src/services/platform.js',
    "  if (isSolanaMethod(attempt.methodId)) {\n    return existsSolanaTransaction(",
    "  if (isTronMethod(attempt.methodId)) {\n    return existsTronTransaction(\n      attempt.instructions.address,\n      attempt.instructions.amount,\n      createdAt,\n      tokenConfig,\n      minimumConfirmations\n    );\n  }\n\n  if (isSolanaMethod(attempt.methodId)) {\n    return existsSolanaTransaction("
)


# ---- Dashboard -------------------------------------------------------------
replace_exact(
    'public/app.js',
    "  ['bnbAddress', 'BNB address'],\n  ['solAddress', 'SOL address'],",
    "  ['bnbAddress', 'BNB address'],\n  ['trxAddress', 'TRON address'],\n  ['solAddress', 'SOL address'],"
)
replace_exact(
    'public/app.js',
    "              <div class=\"mt-2\">Hive, HBD, Steem, SBD, Blurt, Telos, EOS, FIO, WAX, PIVX, and FLS do not need provider webhooks here. NekoPay checks the chain/payment state directly.</div>\n              <div class=\"mt-3\">EVM methods are temporarily disabled right now because the explorer API is blocking requests.</div>",
    "              <div class=\"mt-2\">Direct-chain payments do not need provider webhooks. NekoPay verifies ETH, Polygon, BNB Chain, TRON, Solana, and the other supported chains directly.</div>\n              <div class=\"mt-3\">ETH / Polygon / BNB use the RPC fallback pool. TRON uses TronGrid; set <code class=\"text-white\">TRON_PRO_API_KEY</code> on the NekoPay server for production rate limits.</div>"
)


# ---- Environment + syntax test coverage -----------------------------------
replace_exact(
    '.env.example',
    "NEKOPAY_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com\n",
    "NEKOPAY_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com\nTRON_API_URL=https://api.trongrid.io\nTRON_PRO_API_KEY=\nNEKOPAY_TRON_TIMEOUT_MS=15000\nNEKOPAY_TRON_MAX_PAGES=5\n"
)

package = json.loads(read('package.json'))
test = package['scripts']['test']
needle = 'node --check src/services/evm.js'
replacement = ' && '.join([
    'node --check src/services/evm.js',
    'node --check src/services/tron.js',
    'node --check src/services/platform.js',
    'node --check src/config/platform.js',
    'node --check public/app.js'
])
if replacement not in test:
    if needle not in test:
        raise RuntimeError('package.json: evm syntax check anchor not found')
    package['scripts']['test'] = test.replace(needle, replacement, 1)
write('package.json', json.dumps(package, indent=2) + '\n')


# ---- Documentation ---------------------------------------------------------
readme = read('README.md')
section = r'''

## Direct EVM + TRON stablecoin payments

NekoPay can accept direct-to-merchant-wallet payments without custodying merchant private keys.
Configure one receiving address per network in the dashboard and the checkout automatically exposes
the enabled native assets and tokens for that network.

- Ethereum: ETH, USDC, USDT, DAI
- Polygon: POL, native USDC, USDC.e, USDT, DAI, MYST
- BNB Chain: BNB, Binance-Peg USDC, Binance-Peg USDT
- TRON: TRX, TRC-20 USDT, TRC-20 TUSD

For TRON production deployments, set `TRON_PRO_API_KEY` (and optionally `TRON_API_URL`). Circle
ended USDC support on TRON, so NekoPay intentionally does not advertise a TRON USDC payment method.
Each token payment is verified against its expected contract, receiving address, exact quoted amount,
payment creation time, and the configured confirmation target.
'''
if '## Direct EVM + TRON stablecoin payments' not in readme:
    write('README.md', readme.rstrip() + section + '\n')


# ---- Assertions ------------------------------------------------------------
config_text = read('src/config/platform.js')
for required in [
    "contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'",
    "contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'",
    "contract: '0x1379E8886A944d2D9d440b3d88DF536Aea08d9F3'",
    "chainType: 'tron'"
]:
    if required not in config_text:
        raise RuntimeError(f'missing required token config: {required}')

platform_text = read('src/services/platform.js')
for required in ['existsTronTransaction', 'trxAddress', "getTokenConfig('usdt_trx')"]:
    if required not in platform_text:
        raise RuntimeError(f'missing platform integration: {required}')

# One-shot helper: remove migration-only workflow/script from the finished feature branch.
workflow = ROOT / '.github/workflows/apply-multichain-payments.yml'
if workflow.exists():
    workflow.unlink()
Path(__file__).unlink()
