import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");

if (process.env.CPANEL_AUTO_BUILD === "true" && !fs.existsSync(path.join(root, "dist", "index.html"))) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("cPanel build artifacts are missing. Running production build...");
  execFileSync(npmCommand, ["run", "deploy:build:postgres"], { cwd: root, stdio: "inherit" });
  execFileSync(npmCommand, ["run", "deploy:db:push"], { cwd: root, stdio: "inherit" });
}

await tsImport("./index.ts", import.meta.url);
