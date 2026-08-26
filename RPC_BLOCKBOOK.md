# NekoPay RPC / Blockbook backend layer

This branch adds the network layer used by CryptoWallet-style public/self-hosted backends to NekoPay.

## Why this exists

A payment processor should not assume one explorer URL is permanently available. Public Blockbook and JSON-RPC endpoints can rate-limit, go offline, fall behind the chain, or even answer for the wrong EVM chain.

NekoPay now separates three jobs:

1. **Chain state / broadcast** — Blockbook v2 for UTXO chains, JSON-RPC for EVM chains.
2. **Indexed EVM history** — Blockscout or Routescan where a keyless index exists.
3. **Backend selection** — health probing, cooldown and failover between configured endpoints.

## Files

- `src/network/blockbook.js` — Blockbook v2 status, address, UTXO, tx, raw tx, fee estimate and broadcast.
- `src/network/evm-rpc.js` — EVM chain ID, block height, balance, nonce, gas, logs, contract reads and raw transaction broadcast.
- `src/network/backend-pool.js` — endpoint health, cooldown, pinning and read failover.
- `src/network/backends.js` — built-in public endpoint registry plus merchant/self-hosted overrides.
- `src/network/explorer.js` — normalized Blockscout + Routescan transaction-history/token-discovery adapter.
- `src/network/index.js` — public network manager.
- `src/compat/network-chain-modules.js` — payment-verification modules for common UTXO chains and 20 EVM networks.
- `src/compat/solana-pay-module.js` — internal Solana Pay request/reference verification so NekoPay no longer needs the old payments repository for Solana.

## Important failover rule

Reads may fail over to a second backend when the first backend has a transport/rate-limit failure.

**Broadcasts never automatically retry on a different backend.** If backend A accepted a transaction but its response was lost, blindly sending the same operation again can cause nonce/double-send problems. NekoPay reports the failure and leaves reconciliation to the caller.

## Built-in EVM networks

- Ethereum
- Ethereum Classic
- BNB Smart Chain
- Polygon
- Arbitrum
- Optimism
- Base
- Avalanche C-Chain
- Gnosis
- Cronos
- Linea
- Scroll
- Blast
- zkSync Era
- opBNB
- Mantle
- Celo
- Sonic
- Theta
- BitTorrent Chain

The RPC pool validates `eth_chainId` during probing so a misconfigured endpoint cannot silently serve the wrong network.

## Built-in Blockbook networks in this first NekoPay pass

BTC, LTC, DOGE, DASH, DGB, PIVX, FLS, 777, AZR, BECN, BIR, KYAN, PNY and SAPP.

The Blockbook client itself is generic. More CryptoWallet UTXO entries can be added to `src/network/backends.js` without writing a new client.

## Custom / self-hosted endpoints

### Per-chain environment override

```env
NEKOPAY_BTC_BACKEND_URLS=http://blockbook-btc:9130,https://blockbook.btc.zelcore.io
NEKOPAY_ETH_BACKEND_URLS=http://geth:8545,https://ethereum-rpc.publicnode.com
```

The first entry is tried first. A self-hosted node can therefore be preferred with public endpoints retained as fallback.

### JSON backend file

```env
NEKOPAY_BACKENDS_FILE=/run/secrets/nekopay-backends.json
```

Example:

```json
{
  "BTC": {
    "kind": "blockbook",
    "backends": [
      { "url": "http://blockbook-btc:9130", "operator": "self-hosted" }
    ]
  },
  "ETH": {
    "kind": "evmrpc",
    "chainId": 1,
    "backends": [
      { "url": "http://geth:8545", "operator": "self-hosted" }
    ]
  }
}
```

## Tuning

```env
NEKOPAY_BACKEND_COOLDOWN_MS=300000
NEKOPAY_BACKEND_PROBE_LIMIT=8
NEKOPAY_BLOCKBOOK_MIN_INTERVAL_MS=250
NEKOPAY_BLOCKBOOK_MAX_RETRIES=3
NEKOPAY_BLOCKBOOK_TIMEOUT_MS=20000
NEKOPAY_EVMRPC_MIN_INTERVAL_MS=150
NEKOPAY_EVMRPC_MAX_RETRIES=3
NEKOPAY_EVMRPC_TIMEOUT_MS=20000
NEKOPAY_EXPLORER_MIN_INTERVAL_MS=350
NEKOPAY_EXPLORER_MAX_RETRIES=2
NEKOPAY_EXPLORER_TIMEOUT_MS=20000
NEKOPAY_EVM_SCAN_MAX_BLOCKS=5000
NEKOPAY_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

## Still worth adding

The CryptoWallet comparison also exposed several payment rails/features that are not yet fully wired into NekoPay:

- full CryptoWallet 89-UTXO registry rather than the first common Blockbook set;
- Bitcoin Lightning via self-hosted LND/Core Lightning, alongside the existing ZBD option;
- Monero via `monero-wallet-rpc` using invoice-safe subaddresses/payment tracking;
- TRON/TRC-20 support (not part of CryptoWallet's EVM registry but useful for USDT payments);
- Solana Token-2022 token-payment handling beyond standard SOL/SPL/Solana Pay;
- per-checkout unique/watch-only addresses (xpub or wallet-node address generation) rather than relying only on static merchant addresses;
- explicit underpayment/overpayment/late-payment handling;
- reorg-safe confirmation state and post-confirmation reconciliation;
- admin backend-health UI/API and scheduled endpoint probes.
