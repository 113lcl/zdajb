# Deployment

## Local development

1. Copy `.env.example` to `.env`.
2. Use SQLite locally:

```env
DATABASE_URL="file:../database.db"
PORT=4174
HOST="127.0.0.1"
NODE_ENV="development"
COOKIE_SECURE=false
MEDIA_BASE_URL=""
```

3. Prepare the database and client:

```bash
npm run db:push
npm run prisma:generate
```

4. Run the app:

```bash
npm run dev
```

## Production

Recommended first production stack:

- Node.js web service for Express + React build.
- PostgreSQL database.
- Object storage/CDN for media files.

Environment variables:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?schema=public"
PORT=10000
HOST="0.0.0.0"
NODE_ENV="production"
PUBLIC_APP_URL="https://zdajb.pl"
MEDIA_BASE_URL="https://media.zdajb.pl"
ALLOWED_ORIGINS="https://www.zdajb.pl"
COOKIE_SECURE=true
SESSION_COOKIE_NAME="pj_session"
SESSION_DAYS=30
ALLOW_DEV_GRANTS=false
ADMIN_EMAILS="your@email.pl"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="mailbox@example.com"
SMTP_PASS="mailbox-password"
SMTP_FROM="Zdaj B <no-reply@zdajb.pl>"
CONTACT_EMAIL="kontakt@zdajb.pl"
```

Build command:

```bash
npm ci
npm run deploy:db:push
npm run deploy:build:postgres
```

Start command:

```bash
npm start
```

In production, Express serves API routes and the built React app from `dist`.
Media files should be uploaded separately to object storage/CDN. The app does not copy
`public/media` into `dist`, because the media folder is too large for normal app builds.
See `MEDIA_STORAGE.md`.

## Production readiness checklist

- `NODE_ENV=production`.
- `PUBLIC_APP_URL` uses `https://`.
- `COOKIE_SECURE=true` behind HTTPS.
- `ALLOW_DEV_GRANTS=false`; the development grant endpoint is disabled unless this value is explicitly `true` outside production.
- `ADMIN_EMAILS` contains only trusted owner/admin e-mails.
- Use PostgreSQL for production; keep SQLite only for local development.
- Use `prisma/schema.prisma` for local SQLite.
- Use `prisma/schema.postgres.prisma` for production PostgreSQL.
- Upload `public/media` to storage/CDN and set `MEDIA_BASE_URL`.
- Run `npm run deploy:check` before the first production start.
- Run `npm run deploy:db:push` on the production database before the first start.
- Run `npm run deploy:build:postgres` before starting the production service.
- Verify `/api/health` returns `{ "ok": true }`.
- Verify training video URLs are available while logged out.
- Verify `/api/admin/*`, `/api/exam`, `/api/difficult`, `/api/attempts`, and `/api/progress` are blocked for non-premium users.
- Verify the service worker does not cache `/api/*` or `/media/*`.
- In Stripe Dashboard create a webhook for `https://zdajb.pl/api/stripe/webhook`.
- Enable at least `checkout.session.completed`, `checkout.session.expired`, and `payment_intent.payment_failed`.
- Put the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
- Send a test password reset and e-mail confirmation message after SMTP is configured.
- Use `EMAIL_SETUP.md` for the domain e-mail and SMTP checklist.
- Use `PRODUCTION_CHECKLIST.md` as the final launch checklist.
- Use `DATABASE_MIGRATION.md` when moving local SQLite data to PostgreSQL.

## Commercial backend status

Implemented:

- email/password users;
- httpOnly cookie sessions;
- access grants with expiration;
- Stripe Checkout endpoint and webhook-driven access activation;
- payment records with statuses: pending, paid, expired, failed, configuration_required;
- e-mail verification and password reset tokens with optional SMTP delivery;
- per-user attempts, progress, difficult questions, and category stats;
- public fallback behavior for users without an account;
- public training videos with a daily free-training limit;
- development-only manual access endpoint: `POST /api/access/dev-grant`; disabled in production and disabled by default locally.
