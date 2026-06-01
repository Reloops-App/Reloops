import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ error: "Website screenshot capture is not included in OSS local mode." }, { status: 501 });
});
