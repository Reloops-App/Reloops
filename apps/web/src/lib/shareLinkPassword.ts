// A share link's password (when the owner set one) is stored per-token in
// sessionStorage rather than localStorage — unlike the guest name/email
// identity, a password shouldn't outlive the browser session/tab.
const PREFIX = "reloops:share-password:";

export function getSharePassword(token: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + token);
  } catch {
    return null;
  }
}

export function setSharePassword(token: string, password: string) {
  try {
    sessionStorage.setItem(PREFIX + token, password);
  } catch {
    // private browsing / storage disabled — the password prompt will just
    // reappear on the next request, which is an acceptable fallback.
  }
}

export function clearSharePassword(token: string) {
  try {
    sessionStorage.removeItem(PREFIX + token);
  } catch {
    // no-op
  }
}

export function withSharePassword<T extends Record<string, unknown>>(token: string, body: T): T {
  const password = getSharePassword(token);
  return password ? { ...body, password } : body;
}
