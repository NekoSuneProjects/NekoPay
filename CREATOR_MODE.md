# NekoPay Creator Mode

NekoPay now has two payment modes running on the same service:

- **Merchant Mode** — the existing stores, products, hosted checkout sessions, orders and gateway configuration.
- **Creator Mode** — NekoLive creator linking plus creator-specific checkouts for tips, NyaTreats and subscriptions.

## NekoLive eligibility

NekoLive only exposes linking for monetized creator tiers:

- Affiliate
- Verified
- Partner

A creator links a NekoLive channel to one of their existing NekoPay merchant accounts. Gateway credentials and payout wallets stay entirely in NekoPay.

## Link flow

1. NekoLive calls `POST /api/creator/integrations/nekolive/link/start` using the shared service key.
2. NekoPay returns a short-lived signed URL under `https://pay.nekolive.co.uk/creator/nekolive/link`.
3. The creator signs into NekoPay and selects the NekoPay merchant account that should receive creator payments.
4. NekoLive can query the link through `POST /api/creator/integrations/nekolive/status` or unlink through `/unlink`.

## Creator checkout

NekoLive creates a checkout through:

`POST /api/creator/checkout-sessions`

Supported `productType` values:

- `tip`
- `nyatreat`
- `subscription`

The response contains the normal NekoPay hosted `checkoutUrl` and `embedUrl`. Creator checkout sessions use the existing NekoPay gateway and wallet configuration for the linked merchant account.

`subscription` currently represents a subscription entitlement checkout. NekoLive grants/extends 30 days when it receives the completed checkout webhook. Gateway-native automatic recurring billing can be added later without changing the NekoLive link API.

## Secure callbacks

Creator checkout sessions set a NekoLive notification URL and secret. NekoPay uses the existing outbound checkout webhook system and sends the secret in both:

- `Authorization: Bearer <secret>`
- `x-nekopay-webhook-secret: <secret>`

NekoLive only grants a creator payment/subscription after a `checkout.completed` callback.

## Service configuration

NekoPay:

```env
APP_BASE_URL=https://pay.nekolive.co.uk
APP_URL=https://pay.nekolive.co.uk
PUBLIC_URL=https://pay.nekolive.co.uk
NEKOLIVE_SERVICE_API_KEY=<shared-long-random-secret>
NEKOLIVE_LINK_SIGNING_SECRET=<optional-separate-signing-secret>
```

NekoLive must use the same shared secret as `NEKOPAY_SERVICE_API_KEY`.

## Old payment package replacement

The external `NekoSuneVR/nekosunevr-payments` Git dependency is no longer required by the new NekoPay package design. A local compatibility package name is kept inside NekoPay so older NekoLive `require('nekosunevr-payments')` calls can migrate without breaking in one release.
