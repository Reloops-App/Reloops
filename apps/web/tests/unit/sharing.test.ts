import { beforeEach, describe, expect, it, vi } from "vitest";
import { storagePathFromPublicAssetUrl } from "../../src/lib/privateAssetUrl";
import { keepRecentLocalRows, prependUploadedRow } from "../../src/lib/guestUploadRows";
import { clearSharePassword, getSharePassword, setSharePassword, withSharePassword } from "../../src/lib/shareLinkPassword";
import { buildShareCommentListUrl, buildShareCommentMutationContext, clearShareGuestIdentity, createShareGuestIdentity, loadShareGuestIdentity, saveShareGuestIdentity } from "../../src/lib/shareGuestIdentity";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("private asset URLs", () => {
  const base = "http://localhost:56321/storage/v1/object/public/assets/";
  it("decodes a private path and removes query/hash without signing unrelated URLs", () => {
    expect(storagePathFromPublicAssetUrl(`${base}/ws/My%20File.pdf?download=1#page=2`, base)).toBe("ws/My File.pdf");
    expect(storagePathFromPublicAssetUrl(`${base}ws/file.pdf`, base.slice(0, -1))).toBe("ws/file.pdf");
    expect(storagePathFromPublicAssetUrl(`${base}ws/%broken.pdf`, base)).toBe("ws/%broken.pdf");
    for (const url of [base, `${base}?x=1`, "blob:example", base.replace("assets", "thumbnails") + "a.jpg", base.replace("public", "sign") + "a.pdf", "https://other.example/a.pdf", undefined, null, ""]) {
      expect(storagePathFromPublicAssetUrl(url, base)).toBeNull();
    }
    for (const empty of [null, undefined, ""]) expect(storagePathFromPublicAssetUrl(`${base}a`, empty)).toBeNull();
  });
});

describe("guest upload race handling", () => {
  it("replaces an uploaded row once without changing the input", () => {
    const rows = [{ id: "old" }, { id: "new", title: "stale" }];
    expect(prependUploadedRow(rows, { id: "new", title: "fresh" })).toEqual([{ id: "new", title: "fresh" }, { id: "old" }]);
    expect(rows[1].title).toBe("stale");
  });
  it("keeps recent uploads during a stale fetch, then lets deleted rows expire", () => {
    const fresh = [{ id: "server", title: "authoritative" }];
    const current = [{ id: "local" }, { id: "expired" }, { id: "untracked" }, { id: "server", title: "old" }];
    const times = new Map([["local", 1000], ["expired", 0]]);
    expect(keepRecentLocalRows(fresh, current, times, 60_000)).toEqual([{ id: "local" }, ...fresh]);
    expect(keepRecentLocalRows(fresh, current, times, 61_000)).toBe(fresh);
    expect(keepRecentLocalRows(fresh, current, new Map(), 10)).toBe(fresh);
    expect(keepRecentLocalRows([], [{ id: "local" }], times, 1100, 100)).toEqual([]);
  });
});

describe("share passwords", () => {
  it("isolates passwords per link and preserves request bodies", () => {
    const body = { action: "get" };
    expect(withSharePassword("a", body)).toBe(body);
    setSharePassword("a", "secret");
    expect(getSharePassword("b")).toBeNull();
    expect(withSharePassword("a", body)).toEqual({ action: "get", password: "secret" });
    expect(body).toEqual({ action: "get" });
    expect(localStorage.length).toBe(0);
    clearSharePassword("a");
    expect(getSharePassword("a")).toBeNull();
  });
  it("handles browser storage being unavailable", () => {
    const fail = () => { throw new Error("Storage disabled"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(fail);
    expect(getSharePassword("a")).toBeNull();
    expect(() => setSharePassword("a", "secret")).not.toThrow();
    expect(() => clearSharePassword("a")).not.toThrow();
  });
});

describe("guest identities", () => {
  it("persists a trimmed identity with a stable author token", () => {
    expect(loadShareGuestIdentity()).toBeNull();
    const identity = createShareGuestIdentity({ name: " Jane ", email: " jane@example.test " });
    expect(identity.authorToken).toMatch(/^[\w-]{43}$/);
    saveShareGuestIdentity(identity);
    expect(loadShareGuestIdentity()).toEqual(identity);
    clearShareGuestIdentity();
    expect(loadShareGuestIdentity()).toBeNull();
  });
  it.each(["invalid json", "null", "3", "{}", '{"name":"Jane"}', '{"email":"jane@example.test"}'])("rejects malformed stored identities: %s", (value) => {
    localStorage.setItem("share_guest_identity", value);
    expect(loadShareGuestIdentity()).toBeNull();
  });
  it("migrates old identities without author tokens", () => {
    localStorage.setItem("share_guest_identity", JSON.stringify({ name: "Jane", email: "jane@example.test", authorToken: "short" }));
    expect(loadShareGuestIdentity()?.authorToken.length).toBe(43);
    expect(loadShareGuestIdentity()).toEqual(loadShareGuestIdentity());
  });
  it("includes guest author tokens only for guests and safely encodes list parameters", () => {
    const guest = createShareGuestIdentity({ name: "Jane", email: "jane@example.test" });
    expect(buildShareCommentMutationContext(null, guest)).toBeUndefined();
    expect(buildShareCommentMutationContext("link", guest)).toEqual({ share_token: "link", guest_author_token: guest.authorToken });
    const user = { type: "user" as const, name: "Jane", email: "jane@example.test", userId: "u" };
    expect(buildShareCommentMutationContext("link", user)).toEqual({ share_token: "link" });
    expect(buildShareCommentMutationContext("link", undefined)).toEqual({ share_token: "link" });
    const url = new URL(buildShareCommentListUrl("a&b", guest, "asset?x"), "http://localhost");
    expect(url.searchParams.get("share_token")).toBe("a&b");
    expect(url.searchParams.get("asset_id")).toBe("asset?x");
    expect(url.searchParams.get("guest_author_token")).toBe(guest.authorToken);
    expect(buildShareCommentListUrl("link", user)).not.toContain("guest_author_token");
  });
});
