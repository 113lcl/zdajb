const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { register } = require("tsx/cjs/api");

const root = path.resolve(__dirname, "..");

if (process.env.CPANEL_AUTO_BUILD === "true" && !fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.warn("cPanel build artifacts are missing. Upload the local dist/ directory before starting the app.");
}

if (process.env.CPANEL_AUTO_DB_PUSH === "true" && !fs.existsSync(path.join(root, "tmp", "cpanel-db-ready"))) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("Preparing PostgreSQL schema for cPanel...");
  execFileSync(npmCommand, ["run", "prisma:generate:postgres"], { cwd: root, stdio: "inherit" });
  execFileSync(npmCommand, ["run", "deploy:db:push"], { cwd: root, stdio: "inherit" });
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "cpanel-db-ready"), new Date().toISOString());
}

register();
require("./index.ts");
