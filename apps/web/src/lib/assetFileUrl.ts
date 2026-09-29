import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { storagePathFromPublicAssetUrl } from "@/lib/privateAssetUrl";

const PUBLIC_ASSET_BASE = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
// Reuse a signed URL until 5 minutes before it expires.
const REUSE_FOR_MS = (SIGNED_URL_TTL_SECONDS - 5 * 60) * 1000;

const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string | null>>();

async function signStoragePath(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;

  const request = (async () => {
    // Only members can sign (storage policy); guests already get server-signed URLs.
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return null;
    const { data, error } = await supabase.storage.from("assets").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + REUSE_FOR_MS });
    return data.signedUrl;
  })().finally(() => pending.delete(path));
  pending.set(path, request);
  return request;
}

// Turns a public assets-bucket URL into a signed one the signed-in member can load.
// Any other URL (signed, blob:, thumbnails, external) is returned unchanged, and so is
// the original if signing fails (e.g. no session).
export async function resolveAssetFileUrl(url: string): Promise<string> {
  const path = storagePathFromPublicAssetUrl(url, PUBLIC_ASSET_BASE);
  if (!path) return url;
  return (await signStoragePath(path)) ?? url;
}

export function useResolvedAssetFileUrl(url: string | null | undefined): string | null {
  const needsSigning = Boolean(storagePathFromPublicAssetUrl(url, PUBLIC_ASSET_BASE));
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null);

  useEffect(() => {
    if (!url || !needsSigning) return;
    let active = true;
    void resolveAssetFileUrl(url).then((next) => {
      if (active) setResolved({ source: url, url: next });
    });
    return () => {
      active = false;
    };
  }, [url, needsSigning]);

  if (!url) return null;
  if (!needsSigning) return url;
  return resolved?.source === url ? resolved.url : null;
}
