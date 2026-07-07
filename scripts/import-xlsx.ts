import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";
import XLSX from "xlsx";

const prisma = new PrismaClient();
const root = process.cwd();
const defaultXlsx = path.join(root, "katalog_dla_kandydatów_na_kierowców_052026xlsx.xlsx");
const xlsxPath = path.resolve(process.argv[2] ?? defaultXlsx);
const mediaRoots = (process.argv.slice(3).length ? process.argv.slice(3) : ["multimedia_do_pytan", "Multimedia_do_pytań_-_cz_2_02042026"]).map((item) => path.resolve(root, item));
const publicMedia = path.join(root, "public", "media");

function textValue(value: unknown, fallback = "") {
  return value === undefined || value === null ? fallback : String(value).trim();
}

function intValue(value: unknown, fallback: number) {
  const parsed = Number.parseInt(textValue(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function detectMediaType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".avi", ".m4v", ".wmv"].includes(ext)) return "video";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  return null;
}

function buildMediaIndex() {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      if (entry.isFile()) {
        files.set(entry.name.toLowerCase(), fullPath);
        files.set(path.parse(entry.name).name.toLowerCase(), fullPath);
      }
    }
  };
  mediaRoots.forEach(walk);
  return files;
}

function linkOrCopy(source: string, target: string) {
  if (fs.existsSync(target)) return;
  try {
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function answersFromRow(row: Record<string, unknown>) {
  const a = textValue(row["Odpowiedź A"]);
  const b = textValue(row["Odpowiedź B"]);
  const c = textValue(row["Odpowiedź C"]);
  const abc = [a, b, c].filter(Boolean);
  const correctRaw = textValue(row["Poprawna odp"]).toUpperCase();
  if (abc.length) {
    const map: Record<string, string> = { A: a, B: b, C: c };
    return { options: abc, correctAnswer: map[correctRaw] || correctRaw };
  }
  return {
    options: ["Tak", "Nie"],
    correctAnswer: correctRaw === "T" ? "Tak" : correctRaw === "N" ? "Nie" : correctRaw
  };
}

function hasCategoryB(category: string) {
  return category
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .includes("B");
}

async function main() {
  if (!fs.existsSync(xlsxPath)) throw new Error(`XLSX not found: ${xlsxPath}`);
  fs.mkdirSync(publicMedia, { recursive: true });
  const mediaIndex = buildMediaIndex();
  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const missingMedia: Array<{ id: number; media: string }> = [];
  let imported = 0;

  for (const [index, row] of rows.entries()) {
    const id = intValue(row["Numer pytania"], intValue(row["Lp"], index + 1));
    const text = textValue(row["Pytanie"]);
    if (!text) continue;

    const category = textValue(row["Kategorie"], "Bez kategorii");
    if (!hasCategoryB(category)) continue;

    const weight = Math.min(3, Math.max(1, intValue(row["Liczba punktów"], 1)));
    const mediaName = textValue(row["Media"]);
    const kindRaw = textValue(row["Zakres struktury"]).toUpperCase();
    const kind = kindRaw.includes("PODSTAW") ? "BASIC" : "SPECIALIST";
    const { options, correctAnswer } = answersFromRow(row);

    let mediaPath: string | null = null;
    let mediaType: string | null = null;
    if (mediaName) {
      const source = mediaIndex.get(mediaName.toLowerCase()) ?? mediaIndex.get(path.parse(mediaName).name.toLowerCase());
      if (source) {
        const targetName = `${id}-${path.basename(source)}`;
        const target = path.join(publicMedia, targetName);
        linkOrCopy(source, target);
        mediaPath = `/media/${targetName}`;
        mediaType = detectMediaType(targetName);
      } else {
        missingMedia.push({ id, media: mediaName });
      }
    }

    await prisma.question.upsert({
      where: { id },
      update: { text, category, mediaPath, mediaType, correctAnswer, options: JSON.stringify(options), weight, kind, explanation: null },
      create: { id, text, category, mediaPath, mediaType, correctAnswer, options: JSON.stringify(options), weight, kind, explanation: null }
    });
    imported += 1;
  }

  console.log(`Imported questions: ${imported}`);
  if (missingMedia.length) {
    console.log("Missing media:");
    missingMedia.forEach((item) => console.log(`- question ${item.id}: ${item.media}`));
  }
}

main().finally(async () => prisma.$disconnect());

