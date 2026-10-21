import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// A listening web server is only useful once project sharing can query the
// database. Probe that function too: bootstrap can answer while its worker
// is still starting after a restart.
export async function waitForFunctions({
  base = process.env.SUPABASE_INTERNAL_URL || "http://127.0.0.1:56321",
  timeoutMs = 120_000,
  pollIntervalMs = 1000,
  fetchImpl = fetch,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveReady = 0;
  while (Date.now() < deadline) {
    try {
      const [bootstrap, projectShare] = await Promise.all([
        fetchImpl(`${base}/functions/v1/bootstrap`, { signal: AbortSignal.timeout(5_000) }),
        fetchImpl(`${base}/functions/v1/project-share`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "get", token: "00000000-0000-0000-0000-000000000000" }),
          signal: AbortSignal.timeout(5_000),
        }),
      ]);
      const shareBody = await projectShare.json().catch(() => null);
      const ready = bootstrap.status === 401 && projectShare.status === 404 && shareBody?.error === "Share link not found";
      consecutiveReady = ready ? consecutiveReady + 1 : 0;
      if (consecutiveReady >= 2) return;
    } catch {
      consecutiveReady = 0;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Edge functions did not become ready within the startup timeout");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await waitForFunctions();
}
