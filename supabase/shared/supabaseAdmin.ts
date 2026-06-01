import { createClient } from "https://esm.sh/@supabase/supabase-js";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("URL_SUPABASE")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!
);