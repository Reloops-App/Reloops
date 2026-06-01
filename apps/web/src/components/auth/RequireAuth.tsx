// src/components/auth/RequireAuth.tsx
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import type { SupabaseStoredSession } from "@/lib/supabaseAuthApi"
import { getSupabaseSessionFromStorage, refreshSupabaseSessionViaHttp } from '@/lib/supabaseAuthApi'

type Props = { children: React.ReactNode }

export default function RequireAuth({ children }: Props) {
  const location = useLocation()
  const [session, setSession] = useState<SupabaseStoredSession | null>(() => getSupabaseSessionFromStorage())
  const [checked, setChecked] = useState(false)
  const [hasStoredAuth, setHasStoredAuth] = useState<boolean>(() => Boolean(getSupabaseSessionFromStorage()?.access_token))

  useEffect(() => {
    let canceled = false
    console.log('RequireAuth: checking auth status')

    const onVisibleOrFocus = () => {
      if (document.visibilityState !== 'visible') return

      // Keep the simple "has token" signal updated so we don't mis-redirect on rare auth stalls.
      setHasStoredAuth(Boolean(getSupabaseSessionFromStorage()?.access_token))

      // Try to refresh via HTTP (does not depend on supabase-js internal state).
      void refreshSupabaseSessionViaHttp()
        .then(async (refreshed) => {
          if (!refreshed?.access_token || !refreshed.refresh_token) return
          await supabase.auth.setSession({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
          })
          if (!canceled) setSession(refreshed)
        })
        .catch(() => {
          // ignore
        })
    }

    const runCheck = () => {
      setHasStoredAuth(Boolean(getSupabaseSessionFromStorage()?.access_token))

      if (!canceled) setSession(getSupabaseSessionFromStorage())
      if (!canceled) setChecked(true)
    }

    runCheck()

    window.addEventListener('focus', onVisibleOrFocus)
    document.addEventListener('visibilitychange', onVisibleOrFocus)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (canceled) return
      setSession(getSupabaseSessionFromStorage())
      setHasStoredAuth(Boolean(getSupabaseSessionFromStorage()?.access_token))
    })

    return () => {
      canceled = true
      subscription.unsubscribe()
      window.removeEventListener('focus', onVisibleOrFocus)
      document.removeEventListener('visibilitychange', onVisibleOrFocus)
    }
  }, [])

  // Keep sessions fresh in the background so route changes after long idle don't get "stuck"
  // (most pages load data in effects; if the token is expired, those calls can fail until refresh).
  useEffect(() => {
    if (!session?.expires_at) return

    let canceled = false
    let timer: number | null = null

    const schedule = () => {
      if (!session?.expires_at) return
      const expiresAtMs = session.expires_at * 1000
      const msUntilRefresh = Math.max(5_000, expiresAtMs - Date.now() - 60_000)

      timer = window.setTimeout(async () => {
        try {
          const refreshed = await refreshSupabaseSessionViaHttp()
          if (!refreshed?.access_token || !refreshed.refresh_token) return
          await supabase.auth.setSession({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
          })
          if (!canceled) setSession(refreshed)
        } catch {
          // ignore
        } finally {
          if (!canceled) schedule()
        }
      }, msUntilRefresh)
    }

    schedule()
    return () => {
      canceled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [session?.expires_at])

  if (!checked) return <div style={{ padding: 16 }}>Checking sign-in…</div>
  if (!session && !hasStoredAuth) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/auth?redirectTo=${encodeURIComponent(returnTo)}`} replace state={{ from: location }} />
  }
  return <>{children}</>
}
