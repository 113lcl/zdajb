import fs from "node:fs";
import path from "node:path";

const mediaDir = path.resolve("public", "media");
const byExtension = new Map();
let totalFiles = 0;
let totalBytes = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(fullPath);
    const ext = path.extname(entry.name).toLowerCase() || "(none)";
    const current = byExtension.get(ext) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += stat.size;
    byExtension.set(ext, current);
    totalFiles += 1;
    totalBytes += stat.size;
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

walk(mediaDir);

console.log(`Media directory: ${mediaDir}`);
console.log(`Files: ${totalFiles}`);
console.log(`Total size: ${mb(totalBytes)}`);
console.log("");
console.log("By extension:");
for (const [ext, value] of [...byExtension.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${ext.padEnd(8)} ${String(value.files).padStart(6)} files  ${mb(value.bytes).padStart(12)}`);
}
