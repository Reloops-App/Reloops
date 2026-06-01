import { createClient } from "https://esm.sh/@supabase/supabase-js";

export const supabaseClient = createClient(
  // MUST use naturally provided SUPABASE_URL inside edge containers, as 127.0.0.1 (URL_SUPABASE) throws ECONNREFUSED
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("URL_SUPABASE")!,
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY")!
);

export function createUserClient(accessToken: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? Deno.env.get("URL_SUPABASE")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );
}