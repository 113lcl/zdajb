import "dotenv/config";

const required = [
  "DATABASE_URL",
  "PUBLIC_APP_URL",
  "MEDIA_BASE_URL",
  "ADMIN_EMAILS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM"
];

const optionalButImportant = ["ALLOWED_ORIGINS"];
const errors = [];
const warnings = [];

for (const key of required) {
  if (!process.env[key]) errors.push(`Missing ${key}`);
}

if (process.env.NODE_ENV !== "production") warnings.push("NODE_ENV is not production.");
if (process.env.PUBLIC_APP_URL?.startsWith("http://")) errors.push("PUBLIC_APP_URL must use https:// in production.");
if (!process.env.DATABASE_URL?.startsWith("postgresql://") && !process.env.DATABASE_URL?.startsWith("postgres://")) {
  errors.push("DATABASE_URL must point to PostgreSQL in production.");
}
if (process.env.COOKIE_SECURE !== "true") errors.push("COOKIE_SECURE must be true in production.");
if (process.env.ALLOW_DEV_GRANTS === "true") errors.push("ALLOW_DEV_GRANTS cannot be true in production.");
if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) warnings.push("Stripe is using a test secret key.");
if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") && process.env.STRIPE_WEBHOOK_SECRET?.includes("test")) {
  warnings.push("Check that STRIPE_WEBHOOK_SECRET belongs to the live Stripe webhook.");
}

for (const key of optionalButImportant) {
  if (!process.env[key]) warnings.push(`${key} is empty.`);
}

if (errors.length) {
  console.error("Production check failed:");
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error("\nWarnings:");
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log("Production check passed.");
if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}
