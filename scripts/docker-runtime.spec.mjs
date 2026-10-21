import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer, connect } from "node:net";
import { createTCPForwarder } from "./docker-local-cli.mjs";
import { createWebServer } from "./serve-web.mjs";
import { configureDockerWeb } from "./configure-docker-web.mjs";

test("CLI loopback forwarding carries database bytes to the sibling service", async () => {
  const target = createServer(socket => socket.pipe(socket));
  target.listen(0, "127.0.0.1"); await once(target, "listening");
  const forwarder = createTCPForwarder("127.0.0.1", target.address().port);
  forwarder.listen(0, "127.0.0.1"); await once(forwarder, "listening");
  const client = connect(forwarder.address().port, "127.0.0.1");
  try {
    await once(client, "connect");
    const response = once(client, "data");
    client.write(Buffer.from([0, 1, 255, 42]));
    assert.deepEqual((await response)[0], Buffer.from([0, 1, 255, 42]));
  } finally {
    client.destroy();
    await new Promise(resolve => forwarder.close(resolve));
    await new Promise(resolve => target.close(resolve));
  }
});

test("built app serves SPA routes, PDF workers, HEAD requests, and health without exposing missing assets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reloops-web-test-"));
  writeFileSync(join(dir, "index.html"), "<html>Reloops</html>");
  writeFileSync(join(dir, "pdf.worker.min.mjs"), "export const worker = true;");
  const server = createWebServer(dir);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ["/", "/workspace/a/projects/b", "/share/project/link"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "<html>Reloops</html>");
    }
    const worker = await fetch(base + "/pdf.worker.min.mjs");
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get("content-type"), /javascript/);
    assert.equal(worker.headers.get("x-content-type-options"), "nosniff");
    const head = await fetch(base + "/pdf.worker.min.mjs", { method: "HEAD" });
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength("export const worker = true;")));
    assert.equal(await head.text(), "");
    assert.deepEqual(await (await fetch(base + "/healthz")).json(), { status: "ok" });
    assert.equal((await fetch(base + "/assets/missing.js")).status, 404);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
    assert.equal((await fetch(base + "/%2e%2e%2fsecret")).status, 400);
    assert.equal((await fetch(base + "/%bad")).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime web configuration injects public settings, excludes service keys, and can change between restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "reloops-config-test-"));
  const source = join(dir, "source"), target = join(dir, "target"), envPath = join(dir, ".env");
  mkdirSync(source);
  writeFileSync(join(source, "app.js"), 'const url="http://reloops-runtime.invalid"; const anon="RELOOPS_RUNTIME_ANON_KEY";');
  const configure = (key) => {
    writeFileSync(envPath, `VITE_SUPABASE_URL=http://127.0.0.1:56321\nVITE_SUPABASE_ANON_KEY=${key}\nVITE_APP_URL=http://127.0.0.1:6173\nSUPABASE_SERVICE_ROLE_KEY=never-in-the-browser\n`);
    configureDockerWeb({ source, target, envPath });
    return readFileSync(join(target, "app.js"), "utf8");
  };
  try {
    assert.equal(configure('public-key"escaped'), 'const url="http://127.0.0.1:56321"; const anon="public-key\\"escaped";');
    const second = configure("new-key");
    assert.match(second, /new-key/);
    assert.doesNotMatch(second, /never-in-the-browser|public-key|runtime.invalid/);
    writeFileSync(envPath, "VITE_SUPABASE_URL=http://localhost\n");
    assert.throws(() => configureDockerWeb({ source, target, envPath }), /configuration is missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("startup waits for stable project sharing readiness, not just bootstrap", async () => {
  const { waitForFunctions } = await import("./wait-functions.mjs");
  let attempts = 0;
  await waitForFunctions({ pollIntervalMs: 1, timeoutMs: 2000, fetchImpl: async (url, options) => {
    if (url.endsWith("/bootstrap")) return new Response("Unauthorized", { status: 401 });
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).action, "get");
    attempts += 1;
    // A transient upstream failure must reset consecutive readiness.
    if (attempts === 1 || attempts === 3) return new Response("Bad gateway", { status: 502 });
    return Response.json({ error: "Share link not found" }, { status: 404 });
  }});
  assert.equal(attempts, 5);
  await assert.rejects(waitForFunctions({ pollIntervalMs: 1, timeoutMs: 5, fetchImpl: async () => {
    throw new Error("Backend unavailable");
  }}), /startup timeout/);
});
