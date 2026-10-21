import { createServer, connect } from "node:net";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createTCPForwarder(host, port) {
  return createServer(incoming => {
    const upstream = connect({ host, port });
    incoming.on("error", () => upstream.destroy());
    upstream.on("error", () => incoming.destroy());
    incoming.on("close", () => upstream.destroy());
    upstream.on("close", () => incoming.destroy());
    incoming.pipe(upstream).pipe(incoming);
  });
}

async function runLocalCLI() {
  // Supabase CLI uses localhost for database initialization/restoration even
  // though the Docker daemon starts the database as a sibling container.
  const config = readFileSync(join(process.env.SUPABASE_WORKDIR, "supabase/config.toml"), "utf8");
  const servers = [];
  let child;
  try {
    for (const [section, target] of [["api", process.env.SUPABASE_INTERNAL_URL], ["db", process.env.SUPABASE_DB_URL]]) {
      const body = new RegExp(`\\[${section}\\]\\s*([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1];
      const port = Number(/^port\s*=\s*(\d+)/m.exec(body ?? "")?.[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Missing ${section}.port in Supabase config`);
      const url = new URL(target);
      const server = createTCPForwarder(url.hostname, Number(url.port || port));
      servers.push(server);
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
    }
    child = spawn("supabase", process.argv.slice(2), { stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    const [code] = await once(child, "exit");
    process.exitCode = code ?? 1;
  } finally {
    for (const server of servers) server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runLocalCLI();
