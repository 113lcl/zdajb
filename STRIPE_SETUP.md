# Stripe setup for Zdaj B

The app already has Stripe Checkout and webhook support.

## Local test mode

1. In Stripe Dashboard, enable test mode.
2. Open Developers -> API keys.
3. Copy the test secret key.

Add to `.env`:

```env
STRIPE_SECRET_KEY="sk_test_..."
```

4. Install and log in to Stripe CLI, then forward webhooks:

```bash
stripe login
stripe listen --forward-to localhost:4174/api/stripe/webhook
```

The CLI prints a webhook signing secret. Add it to `.env`:

```env
STRIPE_WEBHOOK_SECRET="whsec_..."
```

5. Restart the app.
6. Buy a plan in test mode.
7. Use the successful test card:

```text
4242 4242 4242 4242
12/34
123
```

After `checkout.session.completed`, the webhook creates an `AccessGrant`.

## Production

1. Finish Stripe account activation.
2. Switch from test mode to live mode.
3. Use the live secret key:

```env
STRIPE_SECRET_KEY="sk_live_..."
```

4. Add a webhook endpoint in Stripe Dashboard:

```text
https://zdajb.pl/api/stripe/webhook
```

Events:

```text
checkout.session.completed
checkout.session.expired
payment_intent.payment_failed
```

5. Copy the endpoint signing secret:

```env
STRIPE_WEBHOOK_SECRET="whsec_..."
```

6. Restart production after changing environment variables.

## Important

- Never put Stripe secret keys into frontend code.
- Test keys start with `sk_test_`.
- Live keys start with `sk_live_`.
- Webhook secrets start with `whsec_`.
- Test card numbers must only be used with test keys.
