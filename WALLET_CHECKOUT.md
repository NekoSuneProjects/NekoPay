# Wallet checkout flow

NekoPay groups direct-chain crypto methods under a single **Crypto Wallet** checkout option.

1. Customer chooses **Crypto Wallet**.
2. Customer chooses a compatible wallet (MetaMask, Coinbase Wallet, Trust Wallet, Phantom, Hive Keychain, Steem Keychain, Blurt Keychain, or generic QR/mobile wallet).
3. Customer chooses the network and token/coin.
4. NekoPay creates the payment and converts the fiat invoice total to the exact crypto amount using the existing server-side quote service.
5. The customer approves the transaction in their connected wallet or scans the locally generated QR code.
6. NekoPay keeps using its existing chain verifier and confirmation rules to mark the payment completed.

Stablecoins are shown first in each compatible network. For example, a US$1 invoice will normally quote close to 1 USDC/USDT, while NekoPay still locks the exact amount returned by the server-side price quote.

TRON remains disabled until a suitable keyless production backend is selected.
