# NekoPay

NekoPay is a self-hosted payment gateway application for creating hosted checkout sessions, routing customers to provider or on-chain payment flows, tracking payment state in the background, and notifying merchant websites when a checkout changes state.

## Development Status

This project is still in active development.

- Expect rough edges, incomplete provider coverage, and bugs.
- Some integrations are stronger than others.
- Webhook behavior, gateway availability, and dashboard UX may still change.
- Do not assume every payment rail is production-hardened yet.

If you deploy this publicly, treat it as a beta system and test each gateway end-to-end before relying on it for live sales.

## What It Does

NekoPay currently provides:

- merchant dashboard for store and gateway configuration
- hosted checkout sessions via API
- background payment checking for supported on-chain methods
- provider webhook handling for supported webhook-backed gateways
- outbound merchant webhooks to your website when checkout state changes
- SQLite by default, with MySQL or MariaDB support through Sequelize

## Current Gateway Coverage

### Provider / Redirect / API

- Stripe
- PayPal
- NOWPayments
- ZBD

### Direct Chain Checking

- Hive
- HBD
- Steem
- SBD
- Blurt
- Telos
- EOS
- FIO
- WAX
- PIVX
- FLS

### Temporarily Disabled

These are in the codebase but currently disabled because the explorer API is blocking requests:

- ETH
- POL
- BNB
- MYST
- USDT on Polygon / Ethereum / BNB Chain
- USDC on Polygon / Ethereum / BNB Chain

## Local Run

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and adjust values.

Important keys:

```env
PORT=3000
APP_BASE_URL=http://localhost:3000
APP_SECRET=replace-with-a-long-random-secret

ADMIN_EMAIL=admin@nekopay.local
ADMIN_PASSWORD=ChangeMe123!

DB_DIALECT=sqlite
DB_STORAGE=./data/nekopay.sqlite
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=nekopay
DB_USER=root
DB_PASSWORD=

CRYPTO_PAYMENT_MIN_CONFIRMATIONS=25
CRYPTO_PAYMENT_TIMEOUT_MINUTES=20
PAYMENT_WORKER_INTERVAL_MS=15000
```

### 3. Start the server

```bash
npm start
```

Open:

- app: `http://localhost:3000`
- example merchant page: `http://localhost:3000/example-store.html` if served separately by your local tooling, or open the file directly if needed

## Database

The app uses Sequelize-backed storage.

Current tables include:

- `users`
- `user_sessions`
- `stores`
- `checkout_sessions`
- `transactions`
- `payments`
- `verification_tokens`
- `password_reset_tokens`
- `issues`
- `logs`

Default storage is SQLite. You can switch to MySQL or MariaDB by changing `DB_DIALECT` and the connection variables in `.env`.

## Merchant Dashboard

After creating a store, go to:

```text
/dashboard
```

From the dashboard, merchants can:

- rotate the store secret API key
- configure gateway credentials
- configure wallet / chain destinations
- see webhook URLs to paste into providers
- create hosted checkout sessions manually
- monitor recent checkout sessions and payment attempts

## Merchant API

The main merchant endpoint is:

```http
POST /api/merchant/checkout-sessions
```

Authentication:

```http
Authorization: Bearer sk_live_...
Content-Type: application/json
```

The `sk_live_...` value is the NekoPay store secret API key from the dashboard.

Do not use:

- Stripe secret key
- PayPal client ID
- PayPal secret
- webhook secrets

### Example Request

```js
const response = await fetch('http://localhost:3000/api/merchant/checkout-sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_STORE_SECRET_KEY'
  },
  body: JSON.stringify({
    itemName: 'VIP Rank',
    itemDescription: 'Gold rank from external site',
    amount: 12.50,
    currency: 'USD',
    notificationUrl: 'https://your-site.com/webhooks/nekopay',
    successUrl: 'https://your-site.com/checkout/success',
    cancelUrl: 'https://your-site.com/checkout/cancel',
    externalId: 'order-12345',
    metadata: {
      productId: 'vip-gold-01',
      userId: '42'
    },
    allowedMethods: ['stripe', 'paypal', 'hive', 'hbd']
  })
});

const session = await response.json();
```

### Allowed Methods Behavior

- If you omit `allowedMethods`, NekoPay uses all currently enabled methods for that store.
- If you send `allowedMethods`, NekoPay filters the list down to only the methods actually enabled in the store gateway config.

### Example Success Response

```json
{
  "id": "chk_xxxxx",
  "status": "Created",
  "allowedMethods": ["stripe", "paypal", "hive", "hbd"],
  "checkoutUrl": "http://localhost:3000/pay/chk_xxxxx"
}
```

## Hosted Checkout Flow

Typical flow:

1. Your website creates a hosted checkout session.
2. NekoPay returns `checkoutUrl`.
3. Your site redirects the customer to the NekoPay hosted checkout page.
4. Customer chooses a payment method.
5. NekoPay either:
   - redirects to provider checkout, or
   - shows direct transfer instructions for on-chain/manual methods
6. Background workers and provider webhooks update the checkout status.
7. NekoPay sends a webhook to your website using the `notificationUrl` you supplied.

## Outbound Merchant Webhooks

This is the webhook NekoPay sends to the merchant website.

You provide it in the checkout session request as:

```json
{
  "notificationUrl": "https://your-site.com/webhooks/nekopay"
}
```

### Events Sent

- `checkout.created`
- `checkout.pending`
- `checkout.completed`
- `checkout.failed`
- `checkout.cancelled`

### Payload Shape

```json
{
  "event": "checkout.completed",
  "status": "Completed",
  "checkoutSessionId": "chk_xxxxx",
  "storeId": "sto_xxxxx",
  "hookId": "1234567",
  "externalId": "order-12345",
  "item": {
    "name": "VIP Rank",
    "description": "Gold rank from external site",
    "amount": 12.5,
    "currency": "USD"
  },
  "customer": {
    "email": "customer@example.com",
    "fullName": "Example Customer",
    "postalCode": "AB12 3CD"
  },
  "payment": {
    "methodId": "hbd",
    "providerReference": "provider-or-chain-id",
    "instructions": {
      "address": "chisdealhd",
      "amount": "1.350",
      "currency": "HBD",
      "memo": "hbd-..."
    },
    "transaction": {
      "txid": "...",
      "conf": 200,
      "address": "chisdealhd",
      "amount": "1.350",
      "currency": "HBD",
      "memo": "hbd-..."
    }
  },
  "metadata": {
    "productId": "vip-gold-01",
    "userId": "42"
  },
  "checkoutUrl": "http://localhost:3000/pay/chk_xxxxx",
  "createdAt": "2026-03-22T00:00:00.000Z"
}
```

### Important Note

Outbound merchant webhooks are currently plain JSON POSTs with:

```http
Content-Type: application/json
```

There is currently no HMAC/signature header on outbound merchant webhooks yet.

If you need signed merchant webhooks, that still needs to be added.

## Inbound Provider Webhooks to NekoPay

These are webhook endpoints that third-party providers call on your NekoPay server.

You can find the exact URLs in the dashboard for each store because they include the store `hookId`.

### Stripe

Paste into Stripe:

```text
https://your-nekopay-domain/webhooks/stripe/{hookId}
```

Recommended event:

```text
checkout.session.completed
```

Put the Stripe signing secret in the dashboard field:

```text
Stripe webhook secret
```

### NOWPayments

Paste into NOWPayments:

```text
https://your-nekopay-domain/webhooks/nowpayments/{hookId}
```

Put the IPN secret in the dashboard field:

```text
NOWPayments IPN secret
```

### PayPal

Paste into PayPal:

```text
https://your-nekopay-domain/webhooks/paypal/{hookId}
```

Recommended events:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DENIED`

Put the PayPal webhook ID in:

```text
PayPal webhook ID
```

### ZBD

For ZBD gamertag charge callbacks, use:

```text
https://your-nekopay-domain/webhooks/zbd/{hookId}
```

Merchant dashboard fields:

- `ZBD API key`
- `ZBD receiver type`
- `ZBD gamertag`
- `ZBD lightning address`

## Which Providers Need Inbound Webhooks

Needs provider webhook setup:

- Stripe
- NOWPayments
- PayPal
- ZBD gamertag charge flow

Does not need provider webhook setup:

- Hive
- HBD
- Steem
- SBD
- Blurt
- Telos
- EOS
- FIO
- WAX
- PIVX
- FLS

Those are checked directly by the app using provider APIs or chain/explorer lookups.

## Background Processing

NekoPay runs payment checks in the background.

That means:

- refreshes do not recreate payments
- checkout status is stored in the database
- confirmations can complete even if the customer leaves the page
- merchant webhooks can still be sent after the payment completes in the background

## Payment Confirmation and Timeout

Configured by `.env`:

```env
CRYPTO_PAYMENT_MIN_CONFIRMATIONS=25
CRYPTO_PAYMENT_TIMEOUT_MINUTES=20
PAYMENT_WORKER_INTERVAL_MS=15000
```

Behavior:

- on-chain payments wait for the configured confirmation threshold
- pending on-chain payments expire after the timeout window
- the background worker checks pending payments on the configured interval

## Example Merchant Page

Use:

```text
example-store.html
```

This page shows how an external website can:

- collect merchant API settings
- create hosted checkout sessions
- pass `notificationUrl`, `successUrl`, `cancelUrl`, `externalId`, and `metadata`
- optionally choose `allowedMethods`

## Known Gaps / Current Risks

- outbound merchant webhooks are not signed yet
- some provider flows still need deeper real-world testing
- EVM payment methods are currently disabled because explorer access is blocked
- ZBD lightning-address mode needs more live validation
- the project is still being actively refactored and polished

## Recommended Production Checklist

Before using this in production, verify:

1. every enabled gateway works end-to-end on your real domain
2. your inbound provider webhooks are correctly configured
3. your merchant `notificationUrl` receives and processes checkout events correctly
4. your confirmation and timeout settings match your risk tolerance
5. your database and `.env` are backed up properly

## License

No formal license has been defined in this repository yet.
