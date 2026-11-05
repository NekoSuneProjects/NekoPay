# Heleket Host-to-Host — initial NekoPay integration

This change introduces a **beta, opt-in** Heleket hosted invoice gateway for NekoPay merchant stores. It uses [the official Node.js SDK](https://github.com/Heleket/nodejs-sdk) rather than implementing API signatures manually.

## Setup

1. Create and verify a merchant with Heleket; obtain its **Merchant ID** and **Payment API key** (not the payout key).
2. Run on **Node.js 20 or later**. Install from the repository lockfile with `npm ci`.
3. In your NekoPay store dashboard, configure the two credentials under the Heleket gateway.
4. Keep `HELEKET_ENABLE_LIVE` unset while evaluating the integration. When ready to issue live invoices, set `HELEKET_ENABLE_LIVE=true` in the server environment and restart.
5. Select **Heleket** at checkout. NekoPay redirects to the Heleket hosted payment page (the SDK's `invoice.url`). A webhook is **not** configured in this initial iteration.

The SDK creates invoices using `amount`, `currency`, a sanitized unique `order_id`, `url_return` and `url_success`. It stores the provider's invoice UUID as the payment attempt reference.

The existing NekoPay checkout status refresh calls the SDK `getInfo({uuid})` and only treats final `paid` or `paid_over` statuses as successful. `check`, `process`, `confirm_check` and `wrong_amount_waiting` are **not** successful. The final `wrong_amount`, `fail`, `cancel`, `system_fail` and `locked` statuses are not successful either.

## Not yet production complete

- A raw-body, signature-verified and replay-protected Heleket webhook handler is **not included** in this initial PR. Checkout must be polled for changes; do not rely on webhooks or instant fulfillment.
- Full payment amount/currency and store/order reconciliation, plus once-only merchant fulfillment, must be hardened before unattended production use.
- Real API integration and webhook tests require an approved merchant account. No live charge has been attempted.
- The UI uses NekoPay's existing hosted-gateway cards; a branded in-page H2H wallet/QR experience has not been built.
- No payout functions or payout credentials are included.

See the [H2H documentation](https://doc.heleket.com/host-to-host) and [Node SDK](https://doc.heleket.com/sdks-and-modules/sdk/node).

**Security:** Never commit merchant credentials, never trust redirect pages as payment evidence, and do not use a payout key to accept payments.
