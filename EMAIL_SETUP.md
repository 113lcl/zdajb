# Email setup for Zdaj B

Recommended simple setup:

1. Receiving contact mail:
   - Create `kontakt@zdajb.pl`.
   - Either use a real mailbox from your domain provider, or use email routing to forward `kontakt@zdajb.pl` to your private mailbox.

2. Sending transactional mail:
   - Use a transactional SMTP provider such as Resend or Brevo.
   - Verify `zdajb.pl` in the provider dashboard.
   - Add the DNS records shown by the provider, usually SPF, DKIM and sometimes DMARC.
   - Create an SMTP/API key.

3. App environment variables:

```env
SMTP_HOST="smtp.resend.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="resend"
SMTP_PASS="YOUR_RESEND_API_KEY"
SMTP_FROM="Zdaj B <no-reply@zdajb.pl>"
```

Brevo alternative:

```env
SMTP_HOST="smtp-relay.brevo.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="YOUR_BREVO_LOGIN"
SMTP_PASS="YOUR_BREVO_SMTP_KEY"
SMTP_FROM="Zdaj B <no-reply@zdajb.pl>"
```

4. Test after deployment:
   - Register a new user.
   - Request email verification.
   - Request password reset.
   - Confirm the messages arrive and are not in spam.

5. Public contact:
   - Show `kontakt@zdajb.pl` on the contact page.
   - Use `no-reply@zdajb.pl` only for automatic messages.

Notes:

- `kontakt@zdajb.pl` is for users writing to you.
- `no-reply@zdajb.pl` is for automatic messages from the app.
- Do not put SMTP keys into frontend code. Keep them only in server environment variables.
