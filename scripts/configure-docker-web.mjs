import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function configureDockerWeb({ source = "/opt/reloops-web", target = "apps/web/dist", envPath = ".env" } = {}) {
  const env = Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  const appUrl = process.env.FRONTEND_URL || env.VITE_APP_URL;
  if (!url || !anon || anon.includes("replace-with-local") || !appUrl) throw new Error("Local browser configuration is missing. Run sync-env first.");
  for (const value of [url, appUrl]) {
    if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error("Browser URLs must use HTTP or HTTPS");
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  // Only browser-safe configuration belongs in this bundle, never service keys.
  const replacements = new Map([
    ["http://reloops-runtime.invalid", url.replace(/\/+$/, "")],
    ["RELOOPS_RUNTIME_ANON_KEY", anon],
    ["http://reloops-app.invalid", appUrl],
  ]);
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.(js|mjs|html)$/.test(entry.name)) continue;
      let text = readFileSync(path, "utf8");
      for (const [placeholder, value] of replacements) text = text.replaceAll(placeholder, JSON.stringify(value).slice(1, -1));
      writeFileSync(path, text);
    }
  }
  visit(target);
  console.log("Configured the built web app with local public connection settings");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) configureDockerWeb();
