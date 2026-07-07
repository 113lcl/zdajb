import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

function hasCategoryB(category) {
  return String(category ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .includes("B");
}

const questions = await prisma.question.findMany({ select: { id: true, category: true, mediaPath: true } });
const keepIds = questions.filter((question) => hasCategoryB(question.category)).map((question) => question.id);
const deleteIds = questions.filter((question) => !hasCategoryB(question.category)).map((question) => question.id);

if (deleteIds.length) {
  await prisma.question.deleteMany({ where: { id: { in: deleteIds } } });
}

const remaining = await prisma.question.findMany({ select: { mediaPath: true } });
const usedMedia = new Set(remaining.map((question) => question.mediaPath).filter(Boolean).map((mediaPath) => path.basename(mediaPath)));
const mediaDir = "D:/prawajazdy/public/media";
let removedMedia = 0;
if (fs.existsSync(mediaDir)) {
  for (const entry of fs.readdirSync(mediaDir, { withFileTypes: true })) {
    if (entry.isFile() && !usedMedia.has(entry.name)) {
      fs.unlinkSync(path.join(mediaDir, entry.name));
      removedMedia += 1;
    }
  }
}

console.log(JSON.stringify({ before: questions.length, kept: keepIds.length, deleted: deleteIds.length, removedMedia }, null, 2));
await prisma.$disconnect();
