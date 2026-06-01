// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'
import { getSupabaseSessionFromStorage } from "@/lib/supabaseAuthApi"

const noOpLock = async (name: string, acquireTimeout: number, fn: () => Promise<any>) => {
  return await fn()
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      lock: noOpLock,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
)

export const getSessionToken = async () => {
  return getSupabaseSessionFromStorage()?.access_token ?? null
}

export const getLoggedInUserProfile = async (): Promise<{ company: string, email: string, email_verified: boolean, full_name: string, phone_verified: boolean, sub: string } | null> => {
  const local = localStorage.getItem('sb-127-auth-token') || localStorage.getItem('sb-jiozuyggxzxljbiizbla-auth-token');

  if (local) {
    const json = JSON.parse(local);
    const user_metadata = json.user.user_metadata;
    return {
      company: user_metadata.company,
      email: user_metadata.email,
      email_verified: user_metadata.email_verified,
      full_name: user_metadata.full_name,
      phone_verified: user_metadata.phone_verified,
      sub: user_metadata.sub
    }
  }

  return null;
}

// export const getLoggedInUserMetadata = async () => {
//   const local = localStorage.getItem('sb-127-auth-token') || localStorage.getItem('sb-jiozuyggxzxljbiizbla-auth-token');
//   if (local) {
//     const json = JSON.parse(local);
//     const user_metadata = json.user.user_metadata;
//     return user_metadata;
//   }
// }
