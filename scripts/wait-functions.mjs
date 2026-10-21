const base = process.env.SUPABASE_INTERNAL_URL || "http://127.0.0.1:56321";
const deadline = Date.now() + 120_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/functions/v1/bootstrap`, { signal: AbortSignal.timeout(5_000) });
    if (response.status === 401) { ready = true; break; }
  } catch { /* The functions container may still be starting. */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error("Edge functions did not become ready within 120 seconds");
