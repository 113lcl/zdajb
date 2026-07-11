import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT ?? 4174);
const isProduction = process.env.NODE_ENV === "production";
const host = process.env.HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1");
const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "pj_session";
const sessionDays = Number(process.env.SESSION_DAYS ?? 30);
const cookieSecure = process.env.COOKIE_SECURE === "true" || isProduction;
const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
const mediaBaseUrl = process.env.MEDIA_BASE_URL?.replace(/\/+$/, "") ?? "";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

function envList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateProductionEnv() {
  if (!isProduction) return;
  const required = [
    "DATABASE_URL",
    "PUBLIC_APP_URL",
    "ADMIN_EMAILS",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM"
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (process.env.PUBLIC_APP_URL?.startsWith("http://")) {
    throw new Error("PUBLIC_APP_URL must use https:// in production.");
  }
  if (process.env.ALLOW_DEV_GRANTS === "true") {
    throw new Error("ALLOW_DEV_GRANTS cannot be true in production.");
  }
}

validateProductionEnv();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !stripeWebhookSecret) {
    return res.status(503).json({ error: "STRIPE_NOT_CONFIGURED" });
  }
  const signature = req.headers["stripe-signature"];
  if (!signature || Array.isArray(signature)) {
    return res.status(400).json({ error: "MISSING_SIGNATURE" });
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return res.status(400).json({ error: "BAD_SIGNATURE", message });
  }
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed", error);
    res.status(500).json({ error: "WEBHOOK_FAILED" });
  }
});

app.use(express.json());
app.use((req, res, next) => {
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) return next();
  if (req.path === "/api/stripe/webhook") return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const allowedOrigins = new Set([
    process.env.PUBLIC_APP_URL,
    ...envList(process.env.ALLOWED_ORIGINS),
    `http://${host}:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4174",
    "http://localhost:4174"
  ].filter(Boolean));
  const isDevLanOrigin = !isProduction && /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):5173$/.test(origin);
  if (isDevLanOrigin) return next();
  if (allowedOrigins.has(origin)) return next();
  res.status(403).json({ error: "BAD_ORIGIN", message: "Żądanie pochodzi z niedozwolonej domeny." });
});
app.use(
  "/media",
  express.static(path.join(root, "public", "media"), {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".wmv") res.setHeader("Content-Type", "video/x-ms-wmv");
      if (ext === ".mp4") res.setHeader("Content-Type", "video/mp4");
      if (ext === ".webm") res.setHeader("Content-Type", "video/webm");
      if ([".mp4", ".webm", ".wmv", ".mov", ".m4v"].includes(ext)) {
        res.setHeader("Cache-Control", "private, no-store");
      }
    }
  })
);

const defaultPlans = [
  { code: "day", name: "1 dzień", days: 1, amount: 600, currency: "PLN", featured: false, active: true, sortOrder: 10 },
  { code: "week", name: "7 dni", days: 7, amount: 1200, currency: "PLN", featured: true, active: true, sortOrder: 20 },
  { code: "month", name: "30 dni", days: 30, amount: 2500, currency: "PLN", featured: false, active: true, sortOrder: 30 },
  { code: "quarter", name: "90 dni", days: 90, amount: 6000, currency: "PLN", featured: false, active: true, sortOrder: 40 }
];

const examPlan = [
  { kind: "BASIC", weight: 3, take: 10 },
  { kind: "BASIC", weight: 2, take: 6 },
  { kind: "BASIC", weight: 1, take: 4 },
  { kind: "SPECIALIST", weight: 3, take: 6 },
  { kind: "SPECIALIST", weight: 2, take: 4 },
  { kind: "SPECIALIST", weight: 1, take: 2 }
];

async function seedQuestionsIfEmpty() {
  const count = await prisma.question.count();
  if (count > 0) return;
  const seedPath = path.join(dirname, "questions-seed.json");
  if (!fs.existsSync(seedPath)) {
    console.warn("Question seed file is missing.");
    return;
  }
  const questions = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!Array.isArray(questions) || !questions.length) return;
  for (let index = 0; index < questions.length; index += 250) {
    const batch = questions.slice(index, index + 250);
    await (prisma.question.createMany as any)({ data: batch, skipDuplicates: true });
  }
  console.log(`Seeded ${questions.length} questions.`);
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function resolveMediaPath(mediaPath: string | null | undefined) {
  if (!mediaPath || !mediaBaseUrl) return mediaPath ?? null;
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
  const normalizedPath = mediaPath.startsWith("/media/") ? mediaPath.slice("/media/".length) : mediaPath.replace(/^\/+/, "");
  return `${mediaBaseUrl}/${normalizedPath}`;
}

function serializeQuestion<T extends { options: string | null; mediaPath?: string | null }>(question: T) {
  return {
    ...question,
    mediaPath: resolveMediaPath(question.mediaPath),
    options: question.options ? JSON.parse(question.options) : null
  };
}

function normalizeEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase();
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function roleForEmail(email: string, userCount: number) {
  return userCount === 0 || adminEmails().includes(email) ? "ADMIN" : "USER";
}

function rateLimit({ windowMs, max, name }: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${name}:${req.ip}:${normalizeEmail(req.body?.email)}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= max) {
      res.status(429).json({ error: "RATE_LIMITED", message: "Za dużo prób. Spróbuj ponownie za chwilę." });
      return;
    }
    current.count += 1;
    next();
  };
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, name: "auth" });

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerifiedAt: Date | null;
  termsAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAcceptedAt: user.privacyAcceptedAt,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

function serializeAdminUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  _count: { sessions: number; accessGrants: number; payments: number; attempts: number; difficult: number };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    counts: user._count
  };
}

function parseCookies(req: Request) {
  const header = req.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}

function getBearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function getSessionToken(req: Request) {
  return parseCookies(req)[sessionCookieName] ?? getBearerToken(req);
}

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`
  ];
  if (cookieSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: Response) {
  const parts = [`${sessionCookieName}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (cookieSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, key] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashPublicToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createAuthToken(userId: string, type: "email_verification" | "password_reset", ttlMinutes: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hashPublicToken(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000)
    }
  });
  return token;
}

async function consumeAuthToken(token: string, type: "email_verification" | "password_reset") {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashPublicToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) return null;
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row;
}

async function sendMail(to: string, subject: string, text: string) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) return { sent: false };
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined
    });
    await transporter.sendMail({ from, to, subject, text });
    return { sent: true };
  } catch (error) {
    console.error("Mail delivery failed", error);
    return { sent: false };
  }
}

function appLink(pathname: string, params: Record<string, string>, baseUrl = publicAppUrl) {
  const url = new URL(pathname, baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function grantPaidAccess(userId: string, plan: { code: string; days: number }, paymentId: string) {
  const existingGrant = await prisma.accessGrant.findFirst({ where: { paymentId } });
  if (existingGrant) return existingGrant;
  const currentAccess = await getActiveAccess(userId);
  const now = new Date();
  const startsAt = currentAccess.expiresAt && new Date(currentAccess.expiresAt) > now ? new Date(currentAccess.expiresAt) : now;
  const expiresAt = new Date(startsAt.getTime() + plan.days * 24 * 60 * 60 * 1000);
  return prisma.accessGrant.create({
    data: {
      userId,
      planCode: plan.code,
      source: "stripe",
      startsAt,
      expiresAt,
      paymentId
    }
  });
}

async function handleStripeEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.paymentId;
    const userId = session.metadata?.userId;
    const planCode = session.metadata?.planCode;
    if (!paymentId || !userId || !planCode) return;
    const plans = await getPlans(true);
    const plan = plans.find((item) => item.code === planCode);
    if (!plan) return;
    const providerPaymentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: "paid",
        paidAt: new Date(),
        providerCheckoutId: session.id,
        providerPaymentId,
        rawPayload: JSON.stringify(event)
      }
    });
    await grantPaidAccess(userId, plan, paymentId);
    return;
  }
  if (event.type === "checkout.session.expired" || event.type === "payment_intent.payment_failed") {
    const data = event.data.object as { metadata?: Record<string, string>; id?: string };
    const paymentId = data.metadata?.paymentId;
    if (!paymentId) return;
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: event.type === "checkout.session.expired" ? "expired" : "failed",
        rawPayload: JSON.stringify(event)
      }
    }).catch(() => undefined);
  }
}

async function getAuth(req: Request) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date()) return null;
  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return { session, user: session.user };
}

async function requireAuth(req: Request, res: Response) {
  const auth = await getAuth(req);
  if (!auth) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Musisz się zalogować." });
    return null;
  }
  return auth;
}

async function requireAdmin(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (auth.user.role !== "ADMIN") {
    res.status(403).json({ error: "ADMIN_REQUIRED", message: "Brak uprawnień administratora." });
    return null;
  }
  return auth;
}

async function requirePremium(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (auth.user.role === "ADMIN") return auth;
  const access = await getActiveAccess(auth.user.id);
  if (!access.hasActiveAccess) {
    res.status(402).json({ error: "PREMIUM_REQUIRED", message: "Ta funkcja wymaga aktywnego dostępu." });
    return null;
  }
  return auth;
}

async function ensurePlans() {
  const count = await prisma.planConfig.count();
  if (count === 0) {
    await prisma.planConfig.createMany({ data: defaultPlans });
  }
}

async function getPlans(includeInactive = false) {
  await ensurePlans();
  return prisma.planConfig.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ sortOrder: "asc" }, { amount: "asc" }]
  });
}

async function createSession(userId: string, req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip
    }
  });
  setSessionCookie(res, token, expiresAt);
}

async function getActiveAccess(userId: string) {
  const now = new Date();
  const grant = await prisma.accessGrant.findFirst({
    where: { userId, startsAt: { lte: now }, expiresAt: { gt: now }, cancelledAt: null },
    orderBy: { expiresAt: "desc" }
  });
  return {
    hasActiveAccess: Boolean(grant),
    planCode: grant?.planCode ?? "free",
    expiresAt: grant?.expiresAt ?? null
  };
}

async function recordUserAnswer({
  userId,
  questionId,
  selectedAnswer,
  isCorrect,
  timeSpentSeconds
}: {
  userId: string;
  questionId: number;
  selectedAnswer?: string | null;
  isCorrect: boolean;
  timeSpentSeconds?: number;
}) {
  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { category: true } });
  await prisma.userQuestionProgress.upsert({
    where: { userId_questionId: { userId, questionId } },
    update: {
      attempts: { increment: 1 },
      correctAttempts: { increment: isCorrect ? 1 : 0 },
      wrongAttempts: { increment: isCorrect ? 0 : 1 },
      lastAnswer: selectedAnswer ?? null,
      lastIsCorrect: isCorrect,
      lastAnsweredAt: new Date(),
      totalTimeSeconds: { increment: Number(timeSpentSeconds ?? 0) }
    },
    create: {
      userId,
      questionId,
      attempts: 1,
      correctAttempts: isCorrect ? 1 : 0,
      wrongAttempts: isCorrect ? 0 : 1,
      lastAnswer: selectedAnswer ?? null,
      lastIsCorrect: isCorrect,
      lastAnsweredAt: new Date(),
      totalTimeSeconds: Number(timeSpentSeconds ?? 0)
    }
  });
  if (question?.category) {
    await prisma.userStatsByCategory.upsert({
      where: { userId_category: { userId, category: question.category } },
      update: {
        totalAnswered: { increment: 1 },
        totalCorrect: { increment: isCorrect ? 1 : 0 }
      },
      create: {
        userId,
        category: question.category,
        totalAnswered: 1,
        totalCorrect: isCorrect ? 1 : 0
      }
    });
  }
}

async function getPool(kind: string, weight: number, take: number) {
  const rows = await prisma.question.findMany({ where: { kind, weight } });
  return shuffle(rows).slice(0, take).map(serializeQuestion);
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/plans", async (_req, res) => res.json(await getPlans()));

app.post("/api/checkout", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const plans = await getPlans();
  const plan = plans.find((item) => item.code === String(req.body?.planCode ?? ""));
  if (!plan) return res.status(400).json({ error: "PLAN_NOT_FOUND", message: "Wybrany pakiet nie jest dostępny." });
  const payment = await prisma.payment.create({
    data: {
      userId: auth.user.id,
      planCode: plan.code,
      amount: plan.amount,
      currency: plan.currency,
      status: stripe ? "pending" : "configuration_required"
    }
  });
  if (!stripe) {
    return res.status(503).json({
      error: "STRIPE_NOT_CONFIGURED",
      message: "Płatności nie są jeszcze skonfigurowane. Uzupełnij STRIPE_SECRET_KEY i STRIPE_WEBHOOK_SECRET.",
      paymentId: payment.id
    });
  }
  try {
    const checkoutReturnUrl = typeof req.headers.origin === "string" ? req.headers.origin : publicAppUrl;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: auth.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: plan.currency.toLowerCase(),
            unit_amount: plan.amount,
            product_data: { name: plan.name }
          }
        }
      ],
      success_url: appLink("/", { checkout: "success" }, checkoutReturnUrl),
      cancel_url: appLink("/", { checkout: "cancelled" }, checkoutReturnUrl),
      metadata: {
        paymentId: payment.id,
        userId: auth.user.id,
        planCode: plan.code
      }
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerCheckoutId: session.id } });
    res.json({ url: session.url, paymentId: payment.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się utworzyć płatności.";
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed", rawPayload: JSON.stringify({ message }) }
    });
    res.status(500).json({ error: "CHECKOUT_FAILED", message: "Nie udało się rozpocząć płatności." });
  }
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? "");
  const name = req.body?.name ? String(req.body.name).trim() : null;
  const acceptedTerms = Boolean(req.body?.acceptedTerms);
  const acceptedPrivacy = Boolean(req.body?.acceptedPrivacy);
  if (!email.includes("@") || email.length > 254) return res.status(400).json({ error: "INVALID_EMAIL", message: "Podaj poprawny adres e-mail." });
  if (password.length < 8) return res.status(400).json({ error: "WEAK_PASSWORD", message: "Hasło musi mieć co najmniej 8 znaków." });
  if (!acceptedTerms || !acceptedPrivacy) return res.status(400).json({ error: "CONSENT_REQUIRED", message: "Zaakceptuj regulamin i politykę prywatności." });
  try {
    const userCount = await prisma.user.count();
    const now = new Date();
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role: roleForEmail(email, userCount),
        passwordHash: hashPassword(password),
        lastLoginAt: now,
        termsAcceptedAt: now,
        privacyAcceptedAt: now
      }
    });
    await createSession(user.id, req, res);
    res.status(201).json({ user: serializeUser(user), access: await getActiveAccess(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unique constraint")) return res.status(409).json({ error: "EMAIL_TAKEN", message: "Konto z tym adresem już istnieje." });
    res.status(500).json({ error: "REGISTER_FAILED", message: "Nie udało się utworzyć konta." });
  }
});

app.post("/api/auth/request-email-verification", authLimiter, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (auth.user.emailVerifiedAt) return res.json({ ok: true, message: "Adres e-mail jest już potwierdzony." });
  const token = await createAuthToken(auth.user.id, "email_verification", 24 * 60);
  const link = appLink("/", { verifyEmail: token });
  const mail = await sendMail(
    auth.user.email,
    "Potwierdź e-mail w Zdaj B",
    `Kliknij link, aby potwierdzić adres e-mail:\n\n${link}\n\nLink jest ważny 24 godziny.`
  );
  res.json({ ok: true, sent: mail.sent, devLink: mail.sent || isProduction ? undefined : link });
});

app.post("/api/auth/verify-email", authLimiter, async (req, res) => {
  const token = String(req.body?.token ?? "");
  if (!token) return res.status(400).json({ error: "TOKEN_REQUIRED", message: "Brakuje linku potwierdzającego." });
  const row = await consumeAuthToken(token, "email_verification");
  if (!row) return res.status(400).json({ error: "TOKEN_INVALID", message: "Link jest nieprawidłowy albo wygasł." });
  const user = await prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  const auth = await getAuth(req);
  if (auth?.user.id === user.id) {
    return res.json({ ok: true, message: "Adres e-mail został potwierdzony.", user: serializeUser(user), access: await getActiveAccess(user.id) });
  }
  res.json({ ok: true, message: "Adres e-mail został potwierdzony. Zaloguj się, aby kontynuować." });
});

app.post("/api/auth/request-password-reset", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  let devLink: string | undefined;
  if (user) {
    const token = await createAuthToken(user.id, "password_reset", 60);
    const link = appLink("/", { resetPassword: token });
    const mail = await sendMail(
      user.email,
      "Reset hasła w Zdaj B",
      `Kliknij link, aby ustawić nowe hasło:\n\n${link}\n\nLink jest ważny 60 minut.`
    );
    if (!mail.sent && !isProduction) devLink = link;
  }
  res.json({
    ok: true,
    devLink,
    message: "Jeśli konto istnieje, wyślemy link do zmiany hasła."
  });
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");
  if (!token) return res.status(400).json({ error: "TOKEN_REQUIRED", message: "Brakuje linku resetowania." });
  if (password.length < 8) return res.status(400).json({ error: "WEAK_PASSWORD", message: "Hasło musi mieć co najmniej 8 znaków." });
  const row = await consumeAuthToken(token, "password_reset");
  if (!row) return res.status(400).json({ error: "TOKEN_INVALID", message: "Link jest nieprawidłowy albo wygasł." });
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId: row.userId } });
  res.json({ ok: true, message: "Hasło zostało zmienione. Zaloguj się ponownie." });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Nieprawidłowy e-mail lub hasło." });
  }
  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, req, res);
  res.json({ user: serializeUser(updatedUser), access: await getActiveAccess(user.id) });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = getSessionToken(req);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const auth = await getAuth(req);
  if (!auth) return res.json({ user: null, access: { hasActiveAccess: false, planCode: "free", expiresAt: null } });
  res.json({ user: serializeUser(auth.user), access: await getActiveAccess(auth.user.id) });
});

app.get("/api/account", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const [access, accessGrants, payments, examAttempts, difficultCount] = await Promise.all([
    getActiveAccess(auth.user.id),
    prisma.accessGrant.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.payment.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.attempt.findMany({
      where: { userId: auth.user.id, mode: "EXAM" },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, score: true, passed: true, startedAt: true, finishedAt: true }
    }),
    prisma.userDifficultQuestion.count({ where: { userId: auth.user.id } })
  ]);
  res.json({
    user: serializeUser(auth.user),
    access,
    accessGrants,
    payments,
    examAttempts,
    difficultCount
  });
});

app.post("/api/account/change-password", authLimiter, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (!verifyPassword(currentPassword, auth.user.passwordHash)) {
    return res.status(400).json({ error: "BAD_PASSWORD", message: "Obecne hasło jest nieprawidłowe." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "WEAK_PASSWORD", message: "Nowe hasło musi mieć co najmniej 8 znaków." });
  }
  if (verifyPassword(newPassword, auth.user.passwordHash)) {
    return res.status(400).json({ error: "SAME_PASSWORD", message: "Nowe hasło musi różnić się od obecnego." });
  }
  await prisma.user.update({ where: { id: auth.user.id }, data: { passwordHash: hashPassword(newPassword) } });
  await prisma.session.deleteMany({ where: { userId: auth.user.id, id: { not: auth.session.id } } });
  res.json({ ok: true, message: "Hasło zostało zmienione. Pozostałe sesje zostały zakończone." });
});

app.get("/api/account/export", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const [accessGrants, payments, attempts, questionProgress, difficult, statsByCategory] = await Promise.all([
    prisma.accessGrant.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "desc" } }),
    prisma.payment.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "desc" } }),
    prisma.attempt.findMany({
      where: { userId: auth.user.id },
      orderBy: { startedAt: "desc" },
      include: { answers: true }
    }),
    prisma.userQuestionProgress.findMany({ where: { userId: auth.user.id }, orderBy: { lastAnsweredAt: "desc" } }),
    prisma.userDifficultQuestion.findMany({ where: { userId: auth.user.id }, orderBy: { addedAt: "desc" } }),
    prisma.userStatsByCategory.findMany({ where: { userId: auth.user.id }, orderBy: { category: "asc" } })
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    user: serializeUser(auth.user),
    accessGrants,
    payments,
    attempts,
    questionProgress,
    difficult,
    statsByCategory
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="zdajb-account-${auth.user.id}.json"`);
  res.json(payload);
});

app.delete("/api/account", authLimiter, async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const password = String(req.body?.password ?? "");
  if (!verifyPassword(password, auth.user.passwordHash)) {
    return res.status(400).json({ error: "BAD_PASSWORD", message: "Hasło jest nieprawidłowe." });
  }
  if (auth.user.role === "ADMIN" && (await prisma.user.count({ where: { role: "ADMIN" } })) <= 1) {
    return res.status(400).json({ error: "LAST_ADMIN", message: "Nie można usunąć ostatniego konta administratora." });
  }
  await prisma.user.delete({ where: { id: auth.user.id } });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/access", async (req, res) => {
  const auth = await getAuth(req);
  if (!auth) return res.json({ hasActiveAccess: false, planCode: "free", expiresAt: null });
  res.json(await getActiveAccess(auth.user.id));
});

app.post("/api/access/dev-grant", async (req, res) => {
  if (isProduction || process.env.ALLOW_DEV_GRANTS !== "true") return res.status(404).json({ error: "NOT_FOUND" });
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const plans = await getPlans();
  const requestedCode = String(req.body?.planCode ?? "week");
  const plan = plans.find((item) => item.code === requestedCode) ?? plans[1];
  const grant = await prisma.accessGrant.create({
    data: {
      userId: auth.user.id,
      planCode: plan.code,
      source: "manual",
      expiresAt: new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000)
    }
  });
  res.json({ grant, access: await getActiveAccess(auth.user.id) });
});

app.get("/api/admin/summary", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const now = new Date();
  const [users, admins, activeAccess, payments, attempts] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.accessGrant.count({ where: { startsAt: { lte: now }, expiresAt: { gt: now }, cancelledAt: null } }),
    prisma.payment.count(),
    prisma.attempt.count()
  ]);
  res.json({ users, admins, activeAccess, payments, attempts });
});

app.get("/api/admin/users", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const query = String(req.query.q ?? "").trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: query ? { OR: [{ email: { contains: query } }, { name: { contains: query } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { sessions: true, accessGrants: true, payments: true, attempts: true, difficult: true } }
    }
  });
  res.json(users.map(serializeAdminUser));
});

app.get("/api/admin/users/:userId", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    include: {
      accessGrants: { orderBy: { createdAt: "desc" }, take: 20 },
      payments: { orderBy: { createdAt: "desc" }, take: 20 },
      attempts: { where: { mode: "EXAM" }, orderBy: { startedAt: "desc" }, take: 20 },
      _count: { select: { sessions: true, accessGrants: true, payments: true, attempts: true, difficult: true } }
    }
  });
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, activeAccess: await getActiveAccess(user.id) });
});

app.patch("/api/admin/users/:userId", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body.email);
  const name = req.body?.name === undefined ? undefined : String(req.body.name ?? "").trim() || null;
  const role = req.body?.role === "ADMIN" ? "ADMIN" : req.body?.role === "USER" ? "USER" : undefined;
  if (email !== undefined && (!email.includes("@") || email.length > 254)) return res.status(400).json({ error: "INVALID_EMAIL" });
  if (auth.user.id === req.params.userId && role === "USER") return res.status(400).json({ error: "CANNOT_DEMOTE_SELF", message: "Nie możesz odebrać roli administratora samemu sobie." });
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { email, name, role },
    include: { _count: { select: { sessions: true, accessGrants: true, payments: true, attempts: true, difficult: true } } }
  });
  res.json(serializeAdminUser(user));
});

app.post("/api/admin/users/:userId/access", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const plans = await getPlans(true);
  const plan = plans.find((item) => item.code === String(req.body?.planCode ?? "week"));
  const days = Number(req.body?.days ?? plan?.days ?? 7);
  if (!Number.isFinite(days) || days <= 0) return res.status(400).json({ error: "INVALID_DAYS" });
  const grant = await prisma.accessGrant.create({
    data: {
      userId: req.params.userId,
      planCode: plan?.code ?? "manual",
      source: "admin",
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    }
  });
  res.json({ grant, activeAccess: await getActiveAccess(req.params.userId) });
});

app.delete("/api/admin/users/:userId/access/:grantId", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const grant = await prisma.accessGrant.update({
    where: { id: req.params.grantId, userId: req.params.userId },
    data: { cancelledAt: new Date() }
  });
  res.json({ grant, activeAccess: await getActiveAccess(req.params.userId) });
});

app.delete("/api/admin/users/:userId/sessions", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  await prisma.session.deleteMany({ where: { userId: req.params.userId } });
  res.json({ ok: true });
});

app.get("/api/admin/plans", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  res.json(await getPlans(true));
});

app.patch("/api/admin/plans/:code", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const amount = req.body?.amount === undefined ? undefined : Math.max(0, Math.round(Number(req.body.amount)));
  const days = req.body?.days === undefined ? undefined : Math.max(1, Math.round(Number(req.body.days)));
  const sortOrder = req.body?.sortOrder === undefined ? undefined : Math.round(Number(req.body.sortOrder));
  const plan = await prisma.planConfig.update({
    where: { code: req.params.code },
    data: {
      name: req.body?.name === undefined ? undefined : String(req.body.name).trim(),
      days,
      amount,
      currency: req.body?.currency === undefined ? undefined : String(req.body.currency).trim().toUpperCase(),
      featured: req.body?.featured === undefined ? undefined : Boolean(req.body.featured),
      active: req.body?.active === undefined ? undefined : Boolean(req.body.active),
      sortOrder
    }
  });
  res.json(plan);
});

app.get("/api/questions", async (_req, res) => {
  const questions = await prisma.question.findMany();
  res.json(shuffle(questions).slice(0, 120).map(serializeQuestion));
});

app.get("/api/questions/random", async (_req, res) => {
  const count = await prisma.question.count();
  if (!count) return res.json(null);
  const skip = Math.floor(Math.random() * count);
  const question = await prisma.question.findFirst({ skip });
  res.json(question ? serializeQuestion(question) : null);
});

app.get("/api/exam", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const groups = await Promise.all(examPlan.map((item) => getPool(item.kind, item.weight, item.take)));
  const basicQuestions = shuffle(groups.slice(0, 3).flat());
  const specialistQuestions = shuffle(groups.slice(3).flat());
  res.json({ passScore: 68, maxScore: 74, questions: [...basicQuestions, ...specialistQuestions] });
});

app.post("/api/difficult/:questionId", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const questionId = Number(req.params.questionId);
  if (!Number.isFinite(questionId)) return res.status(400).json({ error: "INVALID_QUESTION" });
  const row = await prisma.userDifficultQuestion.upsert({
    where: { userId_questionId: { userId: auth.user.id, questionId } },
    update: { mastered: false },
    create: { userId: auth.user.id, questionId }
  });
  res.json(row);
});

app.post("/api/difficult/:questionId/review", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const questionId = Number(req.params.questionId);
  if (!Number.isFinite(questionId)) return res.status(400).json({ error: "INVALID_QUESTION" });
  const isCorrect = Boolean(req.body?.isCorrect);
  const current = await prisma.userDifficultQuestion.findUnique({ where: { userId_questionId: { userId: auth.user.id, questionId } } });
  const correctStreak = isCorrect ? (current?.correctStreak ?? 0) + 1 : 0;
  const mastered = correctStreak >= 2;
  const days = mastered ? 7 : isCorrect ? 2 : 0.5;
  const nextReviewAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const row = await prisma.userDifficultQuestion.upsert({
    where: { userId_questionId: { userId: auth.user.id, questionId } },
    update: { timesReviewed: { increment: 1 }, lastReviewedAt: new Date(), correctStreak, mastered, nextReviewAt },
    create: { userId: auth.user.id, questionId, timesReviewed: 1, lastReviewedAt: new Date(), correctStreak, mastered, nextReviewAt }
  });
  res.json(row);
});

app.patch("/api/difficult/:questionId", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const questionId = Number(req.params.questionId);
  if (!Number.isFinite(questionId)) return res.status(400).json({ error: "INVALID_QUESTION" });
  const mastered = Boolean(req.body?.mastered);
  const row = await prisma.userDifficultQuestion.update({
    where: { userId_questionId: { userId: auth.user.id, questionId } },
    data: {
      mastered,
      correctStreak: mastered ? 2 : 0,
      nextReviewAt: mastered ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : new Date()
    }
  });
  res.json(row);
});

app.delete("/api/difficult/:questionId", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const questionId = Number(req.params.questionId);
  if (!Number.isFinite(questionId)) return res.status(400).json({ error: "INVALID_QUESTION" });
  await prisma.userDifficultQuestion.delete({ where: { userId_questionId: { userId: auth.user.id, questionId } } });
  res.json({ ok: true });
});

app.get("/api/difficult", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const rows = await prisma.userDifficultQuestion.findMany({ where: { userId: auth.user.id }, include: { question: true }, orderBy: [{ mastered: "asc" }, { nextReviewAt: "asc" }] });
  res.json(rows.map((row) => ({ ...row, question: serializeQuestion(row.question) })));
});

app.post("/api/attempts", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const mode = req.body?.mode === "DIFFICULT" ? "DIFFICULT" : req.body?.mode === "ENDLESS" ? "ENDLESS" : "EXAM";
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (answers.some((answer: { questionId?: number }) => !Number.isFinite(Number(answer.questionId)))) {
    return res.status(400).json({ error: "INVALID_ANSWERS" });
  }
  const score = answers.reduce((sum: number, answer: { isCorrect: boolean; weight?: number }) => sum + (answer.isCorrect ? Number(answer.weight ?? 0) : 0), 0);
  const attempt = await prisma.attempt.create({
    data: {
      userId: auth.user.id,
      mode,
      finishedAt: new Date(),
      score,
      passed: mode === "EXAM" ? score >= 68 : false,
      answers: {
        create: answers.map((answer: { questionId: number; isCorrect: boolean; timeSpentSeconds?: number; selectedAnswer?: string }) => ({
          questionId: Number(answer.questionId),
          isCorrect: Boolean(answer.isCorrect),
          timeSpentSeconds: Number(answer.timeSpentSeconds ?? 0),
          selectedAnswer: answer.selectedAnswer ? String(answer.selectedAnswer) : null
        }))
      }
    },
    include: { answers: true }
  });
  await Promise.all(
    answers.map((answer: { questionId: number; isCorrect: boolean; timeSpentSeconds?: number; selectedAnswer?: string }) =>
      recordUserAnswer({
        userId: auth.user.id,
        questionId: Number(answer.questionId),
        isCorrect: Boolean(answer.isCorrect),
        timeSpentSeconds: Number(answer.timeSpentSeconds ?? 0),
        selectedAnswer: answer.selectedAnswer ? String(answer.selectedAnswer) : null
      })
    )
  );
  res.json(attempt);
});

app.get("/api/progress", async (req, res) => {
  const auth = await requirePremium(req, res);
  if (!auth) return;
  const [totalQuestions, answered, correct, wrong, attempts, categories, difficult, recentWrong] = await Promise.all([
    prisma.question.count(),
    prisma.userQuestionProgress.count({ where: { userId: auth.user.id } }),
    prisma.userQuestionProgress.count({ where: { userId: auth.user.id, lastIsCorrect: true } }),
    prisma.userQuestionProgress.count({ where: { userId: auth.user.id, lastIsCorrect: false } }),
    prisma.attempt.findMany({
      where: { userId: auth.user.id, mode: "EXAM" },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { answers: { include: { question: true }, orderBy: { id: "asc" } } }
    }),
    prisma.userStatsByCategory.findMany({ where: { userId: auth.user.id }, orderBy: { category: "asc" } }),
    prisma.userDifficultQuestion.groupBy({ by: ["mastered"], where: { userId: auth.user.id }, _count: true }),
    prisma.userQuestionProgress.findMany({
      where: { userId: auth.user.id, lastIsCorrect: false },
      include: { question: true },
      orderBy: { lastAnsweredAt: "desc" },
      take: 10
    })
  ]);
  const examCount = attempts.length;
  const passedExams = attempts.filter((attempt) => attempt.passed).length;
  const avgScore = examCount ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / examCount) : 0;
  const bestScore = examCount ? Math.max(...attempts.map((attempt) => attempt.score)) : 0;
  const coverage = totalQuestions ? answered / totalQuestions : 0;
  const accuracy = answered ? correct / answered : 0;
  const scoreFactor = Math.min(1, avgScore / 74);
  const readiness = Math.round((coverage * 0.35 + accuracy * 0.4 + scoreFactor * 0.25) * 100);
  res.json({
    totalQuestions,
    answered,
    correct,
    wrong,
    readiness,
    examCount,
    passedExams,
    avgScore,
    bestScore,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      answers: attempt.answers.map((answer) => ({ ...answer, question: serializeQuestion(answer.question) }))
    })),
    categories,
    difficult,
    recentWrong: recentWrong.map((item) => ({ ...item, question: serializeQuestion(item.question) }))
  });
});

app.post("/api/progress/answer", async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const questionId = Number(req.body?.questionId);
  if (!Number.isFinite(questionId)) return res.status(400).json({ error: "INVALID_QUESTION" });
  await recordUserAnswer({
    userId: auth.user.id,
    questionId,
    selectedAnswer: req.body?.selectedAnswer ? String(req.body.selectedAnswer) : null,
    isCorrect: Boolean(req.body?.isCorrect),
    timeSpentSeconds: Number(req.body?.timeSpentSeconds ?? 0)
  });
  res.json({ ok: true });
});

app.get("/api/stats", async (req, res) => {
  const auth = await getAuth(req);
  const attempts = await prisma.attempt.findMany({ where: { mode: "EXAM", userId: auth?.user.id }, orderBy: { startedAt: "asc" }, take: 30 });
  const categories = auth
    ? await prisma.userStatsByCategory.findMany({ where: { userId: auth.user.id }, orderBy: { category: "asc" } })
    : await prisma.statsByCategory.findMany({ orderBy: { category: "asc" } });
  const difficult = auth
    ? await prisma.userDifficultQuestion.groupBy({ by: ["mastered"], where: { userId: auth.user.id }, _count: true })
    : await prisma.difficultQuestion.groupBy({ by: ["mastered"], _count: true });
  res.json({ attempts, categories, difficult });
});

if (isProduction) {
  const distPath = path.join(root, "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
}

seedQuestionsIfEmpty().catch((error) => console.error("Question seed failed", error));

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
