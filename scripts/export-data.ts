import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const outputPath = path.resolve(process.argv[2] ?? "database-export.json");

async function main() {
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Sessions and auth tokens are intentionally not exported.",
    planConfigs: await prisma.planConfig.findMany(),
    questions: await prisma.question.findMany(),
    users: await prisma.user.findMany(),
    payments: await prisma.payment.findMany(),
    accessGrants: await prisma.accessGrant.findMany(),
    attempts: await prisma.attempt.findMany(),
    attemptAnswers: await prisma.attemptAnswer.findMany(),
    difficultQuestions: await prisma.difficultQuestion.findMany(),
    statsByCategory: await prisma.statsByCategory.findMany(),
    userQuestionProgress: await prisma.userQuestionProgress.findMany(),
    userDifficultQuestions: await prisma.userDifficultQuestion.findMany(),
    userStatsByCategory: await prisma.userStatsByCategory.findMany()
  };

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Export saved: ${outputPath}`);
  console.log(`Questions: ${data.questions.length}`);
  console.log(`Users: ${data.users.length}`);
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
