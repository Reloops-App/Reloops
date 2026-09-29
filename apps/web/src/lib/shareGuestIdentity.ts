export type ShareGuestIdentity = {
  type: "guest";
  name: string;
  email: string;
  authorToken: string;
};

export type ShareUserIdentity = {
  type: "user";
  name: string;
  email: string;
  userId: string;
  avatarUrl?: string | null;
};

export type ShareIdentity = ShareGuestIdentity | ShareUserIdentity;

export type CommentMutationContext = {
  share_token: string;
  guest_author_token?: string;
};

export const SHARE_GUEST_IDENTITY_STORAGE_KEY = "share_guest_identity";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createGuestAuthorToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function normalizeGuestIdentity(input: unknown): ShareGuestIdentity | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const authorToken = typeof record.authorToken === "string" && record.authorToken.trim().length >= 32
    ? record.authorToken.trim()
    : createGuestAuthorToken();

  if (!name || !email) return null;
  return { type: "guest", name, email, authorToken };
}

export function createShareGuestIdentity(identity: { name: string; email: string }): ShareGuestIdentity {
  return {
    type: "guest",
    name: identity.name.trim(),
    email: identity.email.trim(),
    authorToken: createGuestAuthorToken(),
  };
}

export function loadShareGuestIdentity(): ShareGuestIdentity | null {
  const raw = window.localStorage.getItem(SHARE_GUEST_IDENTITY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const identity = normalizeGuestIdentity(JSON.parse(raw));
    if (identity) saveShareGuestIdentity(identity);
    return identity;
  } catch {
    return null;
  }
}

export function saveShareGuestIdentity(identity: ShareGuestIdentity) {
  window.localStorage.setItem(
    SHARE_GUEST_IDENTITY_STORAGE_KEY,
    JSON.stringify({
      name: identity.name,
      email: identity.email,
      authorToken: identity.authorToken,
    }),
  );
}

export function clearShareGuestIdentity() {
  window.localStorage.removeItem(SHARE_GUEST_IDENTITY_STORAGE_KEY);
}

export function buildShareCommentMutationContext(
  shareToken: string | null | undefined,
  identity: ShareIdentity | null | undefined,
): CommentMutationContext | undefined {
  if (!shareToken) return undefined;
  if (identity?.type === "guest") {
    return { share_token: shareToken, guest_author_token: identity.authorToken };
  }
  return { share_token: shareToken };
}

export function buildShareCommentListUrl(
  shareToken: string,
  identity: ShareIdentity | null | undefined,
  assetId?: string | null,
) {
  const params = new URLSearchParams({ share_token: shareToken });
  if (assetId) params.set("asset_id", assetId);
  if (identity?.type === "guest") params.set("guest_author_token", identity.authorToken);
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment?${params.toString()}`;
}
