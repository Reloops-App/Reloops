import { supabase } from "@/lib/supabaseClient";
import openClawColorIcon from "@/assets/openclaw-color.png";
import n8nLogoWhite from "@/assets/n8n-logo-white.svg";

export type ApiKeyActor = {
  id: string;
  name: string | null;
  provider?: string | null;
  icon_url?: string | null;
};

export type ActorProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

const PROVIDER_ICON_MAP: Record<string, string> = {
  "custom": openClawColorIcon,
  "zapier": "https://cdn.simpleicons.org/zapier/ff5a1f",
  "n8n": n8nLogoWhite,
};

export function getApiKeyActorIconUrl(actor: Pick<ApiKeyActor, "provider" | "icon_url">): string | null {
  if (actor.icon_url) return actor.icon_url;
  if (!actor.provider) return null;
  return PROVIDER_ICON_MAP[actor.provider] ?? null;
}

export function apiKeyActorProfileId(apiKeyId: string): string {
  return `api-key:${apiKeyId}`;
}

export function isApiKeyActorProfileId(value?: string | null): boolean {
  return typeof value === "string" && value.startsWith("api-key:");
}

export function toApiKeyActorProfile(actor: ApiKeyActor): ActorProfile {
  return {
    id: apiKeyActorProfileId(actor.id),
    display_name: actor.name ?? actor.provider ?? "Developer Key",
    avatar_url: getApiKeyActorIconUrl(actor),
  };
}

export async function loadApiKeyActorProfiles(apiKeyIds: string[]): Promise<Record<string, ActorProfile>> {
  const ids = Array.from(new Set(apiKeyIds.filter(Boolean)));
  if (!ids.length) return {};

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, provider, icon_url")
    .in("id", ids);

  if (error || !data) {
    console.warn("Failed to load API key actors", error);
    return {};
  }

  const map: Record<string, ActorProfile> = {};
  for (const row of data as ApiKeyActor[]) {
    const profile = toApiKeyActorProfile(row);
    map[profile.id] = profile;
  }
  return map;
}
