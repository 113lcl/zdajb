# Production environment values

Fill these in the hosting dashboard.

## Required app values

```env
NODE_ENV="production"
HOST="0.0.0.0"
PORT="10000"
PUBLIC_APP_URL="https://zdajb.pl"
MEDIA_BASE_URL="https://media.zdajb.pl"
ALLOWED_ORIGINS="https://www.zdajb.pl"
COOKIE_SECURE="true"
SESSION_COOKIE_NAME="pj_session"
SESSION_DAYS="30"
ALLOW_DEV_GRANTS="false"
CONTACT_EMAIL="kontakt@zdajb.pl"
```

## Database

```env
DATABASE_URL="postgresql://..."
```

## Owner/admin

```env
ADMIN_EMAILS="tmxkir14@gmail.com"
```

## Stripe

```env
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

Webhook URL:

```text
https://zdajb.pl/api/stripe/webhook
```

Required events:

```text
checkout.session.completed
checkout.session.expired
payment_intent.payment_failed
```

## Resend SMTP

```env
SMTP_HOST="smtp.resend.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="resend"
SMTP_PASS="re_..."
SMTP_FROM="Zdaj B <no-reply@zdajb.pl>"
```
