import { execFileSync } from "node:child_process";
import process from "node:process";

if (process.env.CPANEL_AUTO_BUILD !== "true") {
  console.log("Skipping cPanel build: CPANEL_AUTO_BUILD is not true.");
  process.exit(0);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

run(npmCommand, ["run", "deploy:build:postgres"]);
run(npmCommand, ["run", "deploy:db:push"]);
