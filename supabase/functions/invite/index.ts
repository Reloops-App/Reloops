import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ data: { sent: false, message: "Email invites are disabled in OSS local mode. Add signed-up users from Teams." } });
});
