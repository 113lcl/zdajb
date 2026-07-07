const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { register } = require("tsx/cjs/api");

const root = path.resolve(__dirname, "..");

if (process.env.CPANEL_AUTO_BUILD === "true" && !fs.existsSync(path.join(root, "dist", "index.html"))) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("cPanel build artifacts are missing. Running production build...");
  execFileSync(npmCommand, ["run", "deploy:build:postgres"], { cwd: root, stdio: "inherit" });
  execFileSync(npmCommand, ["run", "deploy:db:push"], { cwd: root, stdio: "inherit" });
}

register();
require("./index.ts");
