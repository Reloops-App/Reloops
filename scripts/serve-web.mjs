import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8" };

export function createWebServer(directory = "apps/web/dist") {
  const root = resolve(directory);
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname === "/healthz") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(req.method === "HEAD" ? undefined : '{"status":"ok"}'); return; }
      let path = resolve(root, "." + pathname);
      if (path !== root && !path.startsWith(root + sep)) { res.writeHead(400); res.end(); return; }
      let info = await stat(path).catch(() => null);
      if (!info?.isFile()) {
        if (pathname !== "/" && extname(pathname)) { res.writeHead(404); res.end(); return; }
        path = resolve(root, "index.html");
        info = await stat(path);
      }
      res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Content-Length": info.size });
      if (req.method === "HEAD") { res.end(); return; }
      const stream = createReadStream(path);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createWebServer();
  server.listen(6173, "0.0.0.0", () => console.log("Built Reloops web app listening on :6173"));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
