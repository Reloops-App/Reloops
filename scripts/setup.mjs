import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const quiet = process.argv.includes("--quiet");

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  if (!quiet) console.log("created .env from .env.example");
} else if (!quiet) {
  console.log("ok .env");
}

if (quiet) process.exit(0);

console.log("");
console.log("Prerequisite check:");
console.log(`${hasCommand("node") ? "ok" : "missing"} node`);
console.log(`${hasCommand("pnpm") ? "ok" : "missing"} pnpm`);
console.log(`${hasCommand("docker") ? "ok" : "missing"} docker`);
console.log(`${hasCommand("supabase") || hasCommand("npx") ? "ok" : "missing"} supabase or npx`);

if (!hasCommand("supabase") && !hasCommand("npx")) {
  console.log("");
  console.log("Install the Supabase CLI or Node.js/npm before running the backend:");
  console.log("  npm install -g supabase");
  console.log("");
}

console.log("Run locally:");
console.log("  pnpm start");
