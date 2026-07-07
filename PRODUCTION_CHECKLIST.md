# Production checklist

## Before first deploy

1. Create a PostgreSQL database.
2. Set environment variables from `.env.production.example`.
3. Upload `public/media` to external storage/CDN.
4. Set `MEDIA_BASE_URL` to the public media domain.
5. Add Stripe live keys.
6. Add Stripe webhook:

```text
https://zdajb.pl/api/stripe/webhook
```

Required Stripe events:

```text
checkout.session.completed
checkout.session.expired
payment_intent.payment_failed
```

7. Keep `ALLOW_DEV_GRANTS=false`.
8. Keep `COOKIE_SECURE=true`.
9. Make sure `ADMIN_EMAILS`, Stripe keys, Stripe webhook secret, and SMTP variables are filled before starting production.

## Build commands

Use these commands on a production host:

```bash
npm ci
npm run deploy:check
npm run deploy:db:push
npm run deploy:build:postgres
```

Start command:

```bash
npm start
```

## Smoke test after deploy

Run the automated public smoke test:

```bash
SMOKE_BASE_URL="https://zdajb.pl" npm run smoke:test
```

On Windows PowerShell:

```powershell
$env:SMOKE_BASE_URL="https://zdajb.pl"; npm run smoke:test
```

Then check the full user flow manually:

1. Open `https://zdajb.pl`.
2. Register a test account.
3. Confirm e-mail delivery.
4. Log in and log out.
5. Open training without subscription.
6. Check that training videos work without payment.
7. Check that exam, difficult questions, full stats, and saved exam history require paid access.
8. Make one Stripe test/live payment depending on the environment.
9. Confirm access appears in the account page.
10. Confirm admin page is visible only for e-mails in `ADMIN_EMAILS`.
11. Open `/api/health` and confirm it returns:

```json
{"ok":true}
```

## Rollback basics

- If the app starts but premium does not activate, check Stripe webhook secret and events.
- If login does not stay active, check `PUBLIC_APP_URL`, `COOKIE_SECURE`, and HTTPS.
- If video does not load, check `MEDIA_BASE_URL` and one direct media URL.
- If database tables are missing, run `npm run deploy:db:push`.
