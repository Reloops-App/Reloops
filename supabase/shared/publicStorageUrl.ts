// Edge functions talk to Supabase through an internal URL (http://kong:8000 in
// local Docker), so storage URLs they sign or build start with a host that
// browsers cannot resolve. Swap that origin for the public API URL.
export function toPublicStorageUrl(
  url: string | null | undefined,
  internalBaseUrl: string | null | undefined,
  publicBaseUrl: string | null | undefined,
): string | null {
  if (!url) return null;
  if (!internalBaseUrl || !publicBaseUrl) return url;
  const internal = internalBaseUrl.replace(/\/+$/, "");
  const external = publicBaseUrl.replace(/\/+$/, "");
  if (internal === external) return url;
  if (url !== internal && !url.startsWith(`${internal}/`)) return url;
  return `${external}${url.slice(internal.length)}`;
}

// PUBLIC_SUPABASE_URL wins. The `supabase start` edge runtime does not read
// .env, so behind the local Docker gateway fall back to the address the browser
// actually called, which Kong passes along as x-forwarded-* headers.
export function resolvePublicSupabaseUrl({ explicit, internalUrl, headers }: {
  explicit: string | null | undefined;
  internalUrl: string | null | undefined;
  headers: Headers | null | undefined;
}): string {
  if (explicit) return explicit;
  const behindDockerGateway = /^https?:\/\/(kong|supabase_kong_[^:/]+)(:\d+)?\/?$/.test(internalUrl ?? "");
  if (!behindDockerGateway || !headers) return "";
  const proto = headers.get("x-forwarded-proto") ?? "";
  const host = headers.get("x-forwarded-host") ?? "";
  const port = headers.get("x-forwarded-port") ?? "";
  if (!/^https?$/.test(proto) || !/^[A-Za-z0-9.-]+$/.test(host) || !/^\d*$/.test(port)) return "";
  const defaultPort = proto === "https" ? "443" : "80";
  return `${proto}://${host}${port && port !== defaultPort ? `:${port}` : ""}`;
}
