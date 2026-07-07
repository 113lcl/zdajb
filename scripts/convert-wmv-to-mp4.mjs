import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const mediaDir = path.resolve("public", "media");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;

if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary path");

function mp4NameFromWmv(fileName) {
  return fileName.replace(/\.wmv$/i, ".mp4");
}

const questions = await prisma.question.findMany({
  where: { mediaPath: { endsWith: ".wmv" } },
  select: { id: true, mediaPath: true }
});

let converted = 0;
let updated = 0;
let failed = 0;

for (const question of questions) {
  if (converted >= limit) break;

  const wmvName = path.basename(question.mediaPath);
  const mp4Name = mp4NameFromWmv(wmvName);
  const source = path.join(mediaDir, wmvName);
  const target = path.join(mediaDir, mp4Name);

  if (!fs.existsSync(source)) {
    console.log(`missing source for question ${question.id}: ${wmvName}`);
    failed += 1;
    continue;
  }

  if (!fs.existsSync(target)) {
    console.log(`converting ${wmvName} -> ${mp4Name}`);
    const result = spawnSync(ffmpegPath, [
      "-y",
      "-i", source,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an",
      target
    ], { stdio: "inherit" });

    if (result.status !== 0 || !fs.existsSync(target)) {
      console.log(`failed ${wmvName}`);
      failed += 1;
      continue;
    }
    converted += 1;
  }

  await prisma.question.update({
    where: { id: question.id },
    data: { mediaPath: `/media/${mp4Name}`, mediaType: "video" }
  });
  updated += 1;
}

console.log(JSON.stringify({ candidates: questions.length, converted, updated, failed }, null, 2));
await prisma.$disconnect();
