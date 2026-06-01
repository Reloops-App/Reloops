export type SupabaseStoredSession = {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  expires_at?: number
  user?: unknown
  [k: string]: unknown
}

export type SupabaseStoredUser = {
  id: string
  email?: string | null
  user_metadata?: Record<string, any>
  [k: string]: unknown
}

const SUPABASE_AUTH_KEY_RE = /^sb-[^-]+-auth-token$/

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const json = atob(padded)
    return safeParseJson<Record<string, any>>(json)
  } catch {
    return null
  }
}

function getExpectedJwtIssuerHost(): string | null {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).host
  } catch {
    return null
  }
}

export function getSupabaseAuthStorageKey(): string | null {
  const expectedHost = getExpectedJwtIssuerHost()
  const keys: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (SUPABASE_AUTH_KEY_RE.test(key)) keys.push(key)
  }

  // Prefer the key whose JWT issuer matches the configured supabase host.
  if (expectedHost) {
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = safeParseJson<SupabaseStoredSession>(raw)
      const token = parsed?.access_token
      if (!token) continue
      const payload = decodeJwtPayload(token)
      const iss = payload?.iss ? String(payload.iss) : ""
      if (iss.includes(expectedHost)) return key
    }
  }

  if (keys.length === 1) return keys[0]

  // Legacy/alternate keys used in this repo
  const legacyKeys = ['sb-127-auth-token', 'sb-jiozuyggxzxljbiizbla-auth-token']
  for (const key of legacyKeys) {
    if (localStorage.getItem(key)) return key
  }

  return keys[0] ?? null
}

export function getSupabaseSessionFromStorage(): SupabaseStoredSession | null {
  const key = getSupabaseAuthStorageKey()
  if (key) {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = safeParseJson<SupabaseStoredSession>(raw)
      if (parsed?.access_token) return parsed
    }
  }

  // Legacy/alternate keys used in this repo
  const legacyKeys = ['sb-127-auth-token', 'sb-jiozuyggxzxljbiizbla-auth-token']
  for (const key of legacyKeys) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const parsed = safeParseJson<any>(raw)
    const access_token = parsed?.access_token
    const refresh_token = parsed?.refresh_token
    if (access_token) return { access_token, refresh_token }
  }

  return null
}

export function getSupabaseAccessTokenFromStorage(): string | null {
  return getSupabaseSessionFromStorage()?.access_token ?? null
}

export function getSupabaseUserFromStorage(): SupabaseStoredUser | null {
  const session = getSupabaseSessionFromStorage()
  const user = session?.user as any
  if (user && typeof user === "object" && typeof user.id === "string") return user as SupabaseStoredUser
  return null
}

export function setSupabaseSessionInStorage(session: SupabaseStoredSession): void {
  const key = getSupabaseAuthStorageKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(session))
  } catch {
    // ignore
  }
}

export function clearSupabaseAuthStorage() {
  const keysToRemove: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (SUPABASE_AUTH_KEY_RE.test(key)) keysToRemove.push(key)
  }

  // Legacy/alternate keys used in this repo
  keysToRemove.push('sb-127-auth-token', 'sb-jiozuyggxzxljbiizbla-auth-token')

  // Older supabase-js storage key (v1)
  keysToRemove.push('supabase.auth.token')

  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

export async function logoutViaSupabaseApi(): Promise<void> {
  const session = getSupabaseSessionFromStorage()

  try {
    if (session?.access_token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      })
    }
  } catch {
    // Best-effort: still clear local state below.
  } finally {
    clearSupabaseAuthStorage()
  }
}

export async function refreshSupabaseSessionViaHttp(): Promise<SupabaseStoredSession | null> {
  const current = getSupabaseSessionFromStorage()
  const refresh_token = current?.refresh_token
  if (!refresh_token) return null

  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token }),
      }
    )

    const payload = await res.json().catch(() => null)
    if (!res.ok || !payload?.access_token) return null

    const expires_in = Number(payload.expires_in ?? 0)
    const nowSec = Math.floor(Date.now() / 1000)
    const expires_at = expires_in ? nowSec + expires_in : payload.expires_at

    const next: SupabaseStoredSession = {
      ...(typeof current === "object" && current ? current : {}),
      ...(typeof payload === "object" && payload ? payload : {}),
      expires_at,
    } as SupabaseStoredSession

    setSupabaseSessionInStorage(next)
    return next
  } catch {
    return null
  }
}

export async function ensureFreshSupabaseSession(minTtlSec = 60): Promise<SupabaseStoredSession | null> {
  const current = getSupabaseSessionFromStorage()
  if (!current?.access_token) return null

  const expiresAt = Number(current.expires_at ?? 0)
  if (!expiresAt) return current

  const nowSec = Math.floor(Date.now() / 1000)
  const ttl = expiresAt - nowSec
  if (ttl > minTtlSec) return current

  return (await refreshSupabaseSessionViaHttp()) ?? current
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, ms = 12_000) {
  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const payload = await res.json().catch(() => null)
    return { res, payload }
  } finally {
    window.clearTimeout(t)
  }
}

export async function getSupabaseUserViaHttp(): Promise<SupabaseStoredUser | null> {
  const token = getSupabaseAccessTokenFromStorage()
  if (!token) return null

  const { res, payload } = await fetchJsonWithTimeout(
    `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!res.ok || !payload?.id) return null
  return payload as SupabaseStoredUser
}

export async function updateSupabaseUserViaHttp(update: { data?: Record<string, any> } & Record<string, any>) {
  const session = await ensureFreshSupabaseSession()
  if (!session?.access_token) throw new Error("Not authenticated")

  const { res, payload } = await fetchJsonWithTimeout(
    `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`,
    {
      method: "PUT",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(update),
    }
  )

  if (!res.ok) {
    const msg = payload?.msg || payload?.message || "Failed to update user"
    throw new Error(String(msg))
  }

  // Keep local storage user metadata in sync for same-tab UX.
  if (payload?.id && typeof payload === "object") {
    const next: SupabaseStoredSession = { ...(session as any), user: payload }
    setSupabaseSessionInStorage(next)
  }

  return payload as SupabaseStoredUser
}
