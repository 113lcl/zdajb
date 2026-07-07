import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const inputPath = path.resolve(process.argv[2] ?? "database-export.json");

const dateFields = new Set([
  "addedAt",
  "cancelledAt",
  "createdAt",
  "emailVerifiedAt",
  "expiresAt",
  "finishedAt",
  "lastAnsweredAt",
  "lastLoginAt",
  "lastReviewedAt",
  "nextReviewAt",
  "paidAt",
  "privacyAcceptedAt",
  "startedAt",
  "startsAt",
  "termsAcceptedAt",
  "updatedAt",
  "usedAt"
]);

function reviveDates(rows: unknown[] | undefined): Record<string, unknown>[] {
  return (rows ?? []).map((row) => {
    const next = typeof row === "object" && row !== null ? { ...row } as Record<string, unknown> : {};
    for (const key of Object.keys(next)) {
      if (dateFields.has(key) && typeof next[key] === "string") {
        next[key] = new Date(next[key]);
      }
    }
    return next;
  });
}

async function createMany(label: string, rows: unknown[] | undefined, create: (data: any[]) => Promise<unknown>) {
  const data = reviveDates(rows);
  if (!data.length) return;
  await create(data);
  console.log(`${label}: ${data.length}`);
}

async function resetPostgresSequences() {
  await prisma.$executeRawUnsafe(`
    SELECT setval(pg_get_serial_sequence('"Attempt"', 'id'), COALESCE((SELECT MAX("id") FROM "Attempt"), 1), true);
  `).catch(() => undefined);
  await prisma.$executeRawUnsafe(`
    SELECT setval(pg_get_serial_sequence('"AttemptAnswer"', 'id'), COALESCE((SELECT MAX("id") FROM "AttemptAnswer"), 1), true);
  `).catch(() => undefined);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));

  await createMany("Plan configs", payload.planConfigs, (data) => prisma.planConfig.createMany({ data }));
  await createMany("Questions", payload.questions, (data) => prisma.question.createMany({ data }));
  await createMany("Users", payload.users, (data) => prisma.user.createMany({ data }));
  await createMany("Payments", payload.payments, (data) => prisma.payment.createMany({ data }));
  await createMany("Access grants", payload.accessGrants, (data) => prisma.accessGrant.createMany({ data }));
  await createMany("Attempts", payload.attempts, (data) => prisma.attempt.createMany({ data }));
  await createMany("Attempt answers", payload.attemptAnswers, (data) => prisma.attemptAnswer.createMany({ data }));
  await createMany("Global difficult questions", payload.difficultQuestions, (data) => prisma.difficultQuestion.createMany({ data }));
  await createMany("Global category stats", payload.statsByCategory, (data) => prisma.statsByCategory.createMany({ data }));
  await createMany("User question progress", payload.userQuestionProgress, (data) => prisma.userQuestionProgress.createMany({ data }));
  await createMany("User difficult questions", payload.userDifficultQuestions, (data) => prisma.userDifficultQuestion.createMany({ data }));
  await createMany("User category stats", payload.userStatsByCategory, (data) => prisma.userStatsByCategory.createMany({ data }));

  await resetPostgresSequences();
  console.log("Import complete.");
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
