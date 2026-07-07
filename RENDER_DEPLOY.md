# Render deploy guide

This project is prepared for Render with `render.yaml`.

## What Render can create from the blueprint

- Web service: `zdajb-web`
- PostgreSQL database: `zdajb-db`
- Build command:

```bash
npm ci && npm run deploy:build:postgres
```

- Pre-deploy command:

```bash
npm run deploy:db:push
```

- Start command:

```bash
npm start
```

## Values you must add manually

In Render, set these secret environment variables:

```env
ADMIN_EMAILS="tmxkir14@gmail.com"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
SMTP_PASS="re_..."
```

Check these normal environment variables:

```env
PUBLIC_APP_URL="https://zdajb.pl"
MEDIA_BASE_URL="https://media.zdajb.pl"
ALLOWED_ORIGINS="https://www.zdajb.pl"
SMTP_FROM="Zdaj B <no-reply@zdajb.pl>"
CONTACT_EMAIL="kontakt@zdajb.pl"
```

## DNS in Cloudflare

After Render gives the service hostname, add DNS records in Cloudflare:

```text
zdajb.pl      CNAME or A/ALIAS according to Render instructions
www.zdajb.pl  CNAME to the Render hostname
```

For media storage/CDN:

```text
media.zdajb.pl  CNAME to the storage/CDN hostname
```

## After deploy

Run:

```powershell
$env:SMOKE_BASE_URL="https://zdajb.pl"; npm run smoke:test
```

Then manually test:

1. Register.
2. Confirm e-mail.
3. Open training and play a video.
4. Hit the free training limit path.
5. Try exam without premium.
6. Pay with Stripe.
7. Confirm premium access.
8. Run exam and check account history.
9. Open admin panel with `ADMIN_EMAILS`.

## If deploy fails

- Missing env variable: check `npm run deploy:check` output.
- Database tables missing: run `npm run deploy:db:push`.
- Login cookie not staying: check HTTPS, `PUBLIC_APP_URL`, and `COOKIE_SECURE=true`.
- Video missing: check `MEDIA_BASE_URL` and open one direct media URL.
- Payment not activating access: check Stripe webhook URL and `STRIPE_WEBHOOK_SECRET`.
