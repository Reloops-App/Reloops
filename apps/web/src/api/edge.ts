import {
  getSupabaseSessionFromStorage,
  refreshSupabaseSessionViaHttp,
} from "@/lib/supabaseAuthApi"

export type EdgeFunctionError = {
  message: string
  status: number
  payload?: unknown
}

export type EdgeFunctionInvokeOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

let refreshInFlight: Promise<ReturnType<typeof refreshSupabaseSessionViaHttp>> | null = null
async function refreshOnce() {
  if (!refreshInFlight) {
    refreshInFlight = refreshSupabaseSessionViaHttp().finally(() => {
      refreshInFlight = null
    })
  }
  return await refreshInFlight
}

export async function invokeEdgeFunction<T = any>(
  functionName: string,
  options: EdgeFunctionInvokeOptions = {}
): Promise<{ data: T | null; error: EdgeFunctionError | null }> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`

  const session = getSupabaseSessionFromStorage()
  const sessionAuthHeader = session?.access_token ? `Bearer ${session.access_token}` : null
  const headers: Record<string, string> = {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    ...(sessionAuthHeader ? { Authorization: sessionAuthHeader } : {}),
    ...(options.headers ?? {}),
  }

  let body: BodyInit | undefined = undefined
  if (typeof options.body !== "undefined") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json"
    body =
      typeof options.body === "string" || options.body instanceof FormData
        ? (options.body as any)
        : JSON.stringify(options.body)
  }

  const readPayload = async (res: Response) => {
    const contentType = res.headers.get("content-type") ?? ""
    const isJson = contentType.includes("application/json")
    try {
      return isJson ? await res.json() : await res.text()
    } catch {
      return null
    }
  }

  const run = async () => {
    const res = await fetch(url, {
      method: options.method ?? "POST",
      headers,
      body,
      signal: options.signal,
    })
    const payload = await readPayload(res)
    return { res, payload }
  }

  try {
    let { res, payload } = await run()

    // If the access token expired during long idle/sleep, refresh once and retry.
    const callerAuthHeader = options.headers?.Authorization ?? options.headers?.authorization
    const canRetryAuth =
      res.status === 401 &&
      Boolean(session?.refresh_token) &&
      (typeof callerAuthHeader === "undefined" ||
        String(callerAuthHeader).trim().toLowerCase().startsWith("bearer "))

    if (canRetryAuth) {
      const refreshed = await refreshOnce()
      if (refreshed?.access_token) {
        headers.Authorization = `Bearer ${refreshed.access_token}`
        ;({ res, payload } = await run())
      }
    }

    if (!res.ok) {
      const message =
        typeof payload === "object" && payload && "message" in payload
          ? String((payload as any).message)
          : typeof payload === "object" && payload && "error" in payload
            ? String((payload as any).error)
          : res.statusText || "Edge function request failed"
      return { data: null, error: { message, status: res.status, payload } }
    }

    return { data: payload as T, error: null }
  } catch (e: any) {
    return {
      data: null,
      error: { message: e?.message ?? "Network error calling edge function", status: 0 },
    }
  }
}
