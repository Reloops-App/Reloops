import { expect, test, type Page, type Route } from "@playwright/test";

// UAT for HTML5 banner review (preview + Code view), driven through the real
// app routes the way a reviewer uses them. The backend is mocked at the
// network layer (Supabase REST / edge functions / storage), so this runs on a
// clean checkout with no Docker stack.

const SUPABASE = "http://127.0.0.1:56321";
const ASSET_HOST = "http://assets.reloops.test";
const BANNER_URL = `${ASSET_HOST}/ws-1/summer-sale.html`;
const ARTICLE_URL = `${ASSET_HOST}/ws-1/launch-notes.html`;

const BANNER_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="ad.size" content="width=300,height=250">
  <title>Summer Sale</title>
  <style>html,body{margin:0;width:300px;height:250px;font-family:sans-serif;background:#ffe9a8}</style>
</head>
<body>
  <h1 id="headline">Summer Sale -40%</h1>
  <a id="cta" href="#">Shop now</a>
  <script>
    var parentAccess = "blocked";
    try { parentAccess = window.parent.document.title ? "leaked" : "blocked"; } catch (e) { parentAccess = "blocked"; }
    var storageAccess = "blocked";
    try { window.localStorage.getItem("x"); storageAccess = "leaked"; } catch (e) { storageAccess = "blocked"; }
    window.parent.postMessage({ source: "uat-probe", parentAccess: parentAccess, storageAccess: storageAccess }, "*");
  </script>
</body>
</html>
`;

// A regular HTML document (no ad size anywhere) -- should fill the stage and
// scroll like a page instead of being boxed as an ad.
const ARTICLE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Launch notes</title></head>
<body style="margin:0;font-family:sans-serif">
  <h1>Launch notes</h1>
  <div style="height:2600px;background:linear-gradient(#fff,#ddd)">Long body</div>
  <p id="footer">End of document</p>
</body></html>
`;

const SHARE_TOKEN = "tok-banner";
const ASSET_ID = "asset-banner-1";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

type MockState = {
  // While true, every request for the banner file fails (dev StrictMode
  // double-runs effects, so a one-shot failure count would be flaky).
  bannerFailing: boolean;
  postedComments: Array<Record<string, unknown>>;
};

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

async function fulfillJson(route: Route, body: unknown, status = 200) {
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
}

function bannerAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    title: "summer-sale.html",
    name: "summer-sale.html",
    mime_type: "text/html",
    storage_path: BANNER_URL,
    file_url: BANNER_URL,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    created_at: "2026-11-01T10:00:00.000Z",
    status: "in_review",
    version_no: 1,
    ...overrides,
  };
}

async function mockStorage(page: Page, state: MockState) {
  await page.route(`${ASSET_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.startsWith(BANNER_URL) && state.bannerFailing) {
      return route.fulfill({ status: 500, headers: cors, body: "boom" });
    }
    const body = url.startsWith(ARTICLE_URL) ? ARTICLE_HTML : BANNER_HTML;
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/html; charset=utf-8" }, body });
  });
}

async function mockGuestShare(page: Page, state: MockState, asset = bannerAsset()) {
  await mockStorage(page, state);
  await page.route(`${SUPABASE}/auth/v1/**`, (route) => fulfillJson(route, { error: "no session" }, 401));
  await page.route(`${SUPABASE}/functions/v1/share`, (route) =>
    fulfillJson(route, {
      data: { id: "share-1", asset_id: asset.id, allow_download: false, allow_comments: true, is_member: false, assets: asset },
    }),
  );
  await page.route(`${SUPABASE}/functions/v1/comment**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() === "GET") return fulfillJson(route, { data: [], profiles: {} });
    const payload = req.postDataJSON() as Record<string, unknown>;
    state.postedComments.push(payload);
    return fulfillJson(route, {
      data: {
        id: `c-${state.postedComments.length}`,
        asset_id: payload.asset_id,
        author_user_id: null,
        guest_name: payload.guest_name,
        body: payload.body,
        ms_offset: null,
        drawing_json: payload.drawing_json,
        created_at: new Date().toISOString(),
        status: "active",
      },
    });
  });
}

async function collectProbeMessages(page: Page) {
  await page.addInitScript(() => {
    (window as any).__uatProbes = [];
    window.addEventListener("message", (event) => {
      if (event.data?.source === "uat-probe") (window as any).__uatProbes.push(event.data);
    });
  });
}

function bannerFrame(page: Page, title = "summer-sale.html") {
  return page.locator(`iframe[title="${title}"]`);
}

function sizeSelect(page: Page) {
  return page.getByRole("combobox").filter({ hasText: /Auto-detect|×/ });
}

test.describe("HTML5 banner review — guest on a share link", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = { bannerFailing: false, postedComments: [] };
    page.setDefaultTimeout(8000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await collectProbeMessages(page);
    await mockGuestShare(page, state);
  });

  test("opens the banner live at its detected ad size, sandboxed from the app", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKEN}`);

    const frame = bannerFrame(page);
    await expect(frame).toBeVisible();
    await expect(page.frameLocator(`iframe[title="summer-sale.html"]`).getByText("Summer Sale -40%")).toBeVisible();

    // Reviewer sees which size was picked up from <meta name="ad.size">.
    await expect(sizeSelect(page)).toContainText("Auto-detected · 300 × 250");
    await expect(page.getByText("300×250", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const box = await frame.boundingBox();
      return box ? [Math.round(box.width), Math.round(box.height)] : null;
    }).toEqual([300, 250]);

    // Untrusted creative runs scripts but can't reach the app's DOM or storage.
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await expect.poll(() => page.evaluate(() => (window as any).__uatProbes.at(-1) ?? null)).toEqual({
      source: "uat-probe",
      parentAccess: "blocked",
      storageAccess: "blocked",
    });
  });

  test("switches between IAB size presets and zooms", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKEN}`);
    await expect(sizeSelect(page)).toContainText("300 × 250");

    await sizeSelect(page).click();
    await page.getByRole("option", { name: "728 × 90 · Leaderboard" }).click();
    await expect(page.getByText("728×90", { exact: true })).toBeVisible();
    await expect.poll(async () => Math.round((await bannerFrame(page).boundingBox())?.width ?? 0)).toBe(728);

    await sizeSelect(page).click();
    await page.getByRole("option", { name: /Auto-detected · 300 × 250/ }).click();
    await expect(page.getByText("300×250", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("120%", { exact: true })).toBeVisible();
    await expect.poll(async () => Math.round((await bannerFrame(page).boundingBox())?.width ?? 0)).toBe(360);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(page.getByText("83%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
  });

  test("Code view shows highlighted source with line numbers, copies it, and exits back to preview", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/share/${SHARE_TOKEN}`);
    await expect(bannerFrame(page)).toBeVisible();

    await page.getByRole("button", { name: "Code", exact: true }).click();

    const code = page.locator(".html5-banner-code");
    await expect(code).toContainText('<meta name="ad.size" content="width=300,height=250">');
    await expect(page.getByText("summer-sale.html", { exact: true }).last()).toBeVisible();
    // Syntax highlighted (Shiki emits coloured spans), one .line per source line.
    await expect(code.locator("pre.shiki")).toBeVisible();
    await expect(code.locator(".line")).toHaveCount(BANNER_HTML.split("\n").length);
    expect(await code.locator("span[style*='color']").count()).toBeGreaterThan(10);

    // Preview-only chrome goes away; annotation tabs are disabled over raw source.
    await expect(bannerFrame(page)).toHaveCount(0);
    await expect(sizeSelect(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Comment", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(BANNER_HTML);
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 3000 });

    // Esc returns to the live banner.
    await page.keyboard.press("Escape");
    await expect(bannerFrame(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Comment", exact: true })).toBeEnabled();

    // Toggling Code twice and the View tab both return to preview too.
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(code).toBeVisible();
    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(bannerFrame(page)).toBeVisible();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(bannerFrame(page)).toBeVisible();
  });

  test("Code view recovers from a failed source load with Retry, and offers Back to preview", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKEN}`);
    await expect(bannerFrame(page)).toBeVisible();

    state.bannerFailing = true;
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByText("Couldn't load the banner source.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();

    state.bannerFailing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".html5-banner-code")).toContainText("Summer Sale -40%");
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();

    state.bannerFailing = true;
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByText("Couldn't load the banner source.")).toBeVisible();
    await page.getByRole("button", { name: "Back to preview" }).click();
    await expect(bannerFrame(page)).toBeVisible();
  });

  test("guest pins a comment on the banner, identifies themselves, and sees it in the thread", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKEN}`);
    const frame = bannerFrame(page);
    await expect(frame).toBeVisible();

    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Click to place a pin")).toBeVisible();

    const box = (await frame.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
    const note = page.getByPlaceholder("Type feedback here...").first();
    await expect(note).toBeVisible();
    await note.fill("Make the CTA bigger");
    await page.getByRole("button", { name: "Add note" }).click();

    // First comment from an unknown guest asks who they are.
    const identity = page.getByRole("dialog");
    await expect(identity).toContainText("identify yourself");
    await identity.getByLabel("Your Name").fill("Riley Reviewer");
    await identity.getByLabel("Email Address").fill("riley@example.com");
    await identity.getByRole("button", { name: "Continue as Guest" }).click();
    await expect(identity).toBeHidden();

    await expect.poll(() => state.postedComments.length).toBe(1);
    const posted = state.postedComments[0];
    expect(posted).toMatchObject({
      asset_id: ASSET_ID,
      body: "Make the CTA bigger",
      share_token: SHARE_TOKEN,
      guest_name: "Riley Reviewer",
      guest_email: "riley@example.com",
      ms_offset: null,
    });
    const point = (posted.drawing_json as Array<{ points: Array<{ x: number; y: number }> }>)[0].points[0];
    expect(point.x).toBeCloseTo(0.25, 1);
    expect(point.y).toBeCloseTo(0.75, 1);

    await expect(page.getByText("Make the CTA bigger").first()).toBeVisible();
    await expect(page.locator('button[title="Drag to move this pin"]')).toHaveCount(1);
  });

  test("a plain HTML document (no ad size) fills the stage and scrolls like a page", async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    state = { bannerFailing: false, postedComments: [] };
    await mockGuestShare(page, state, bannerAsset({ title: "launch-notes.html", name: "launch-notes.html", storage_path: ARTICLE_URL, file_url: ARTICLE_URL }));
    await page.goto(`/share/${SHARE_TOKEN}`);

    const frame = bannerFrame(page, "launch-notes.html");
    await expect(frame).toBeVisible();
    await expect(sizeSelect(page)).toContainText("Auto-detect size");
    // Inlined with a <base> so relative assets keep resolving, then sized to its real height.
    await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<base href="${ARTICLE_URL.replace(/[.]/g, "\\.")}`));
    await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThan(2500);
    await expect(page.frameLocator(`iframe[title="launch-notes.html"]`).getByText("End of document")).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Signed-in member opening the banner from their project.

function fakeJwt(payload: Record<string, unknown>) {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

async function mockMemberReview(page: Page, state: MockState) {
  await mockStorage(page, state);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, email: "member@example.com", aud: "authenticated", role: "authenticated", user_metadata: { full_name: "Morgan Member" } };
  const accessToken = fakeJwt({ sub: USER_ID, iss: `${SUPABASE}/auth/v1`, exp, role: "authenticated", email: user.email });
  const session = { access_token: accessToken, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user };

  await page.addInitScript((value) => localStorage.setItem("sb-127-auth-token", value), JSON.stringify(session));
  await page.route(`${SUPABASE}/auth/v1/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/user")) return fulfillJson(route, user);
    return fulfillJson(route, session);
  });

  const asset = bannerAsset({ workspaces: { name: "Acme" }, projects: { name: "Summer campaign" }, uploaded_by: USER_ID });
  const rows: Record<string, unknown> = {
    assets: asset,
    projects: { id: PROJECT_ID, name: "Summer campaign", workspace_id: WORKSPACE_ID },
    workspaces: { id: WORKSPACE_ID, name: "Acme", organization_id: "org-1" },
    organization_members: { role: "owner" },
    profiles: { id: USER_ID, display_name: "Morgan Member", avatar_url: null },
  };
  await page.route(`${SUPABASE}/rest/v1/**`, (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const table = new URL(req.url()).pathname.split("/").pop() ?? "";
    const row = rows[table];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) return row ? fulfillJson(route, row) : fulfillJson(route, null);
    return fulfillJson(route, row ? [row] : []);
  });
  await page.route(`${SUPABASE}/functions/v1/**`, (route) => fulfillJson(route, { data: [] }));
  await page.route(`${SUPABASE}/realtime/**`, (route) => route.abort());
}

test("signed-in member opens an .html upload and gets the banner viewer with Code view (not the image viewer)", async ({ page }) => {
  const state: MockState = { bannerFailing: false, postedComments: [] };
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockMemberReview(page, state);

  await page.goto(`/workspace/${WORKSPACE_ID}/projects/${PROJECT_ID}/assets/${ASSET_ID}`);

  await expect(page.frameLocator(`iframe[title="summer-sale.html"]`).getByText("Summer Sale -40%")).toBeVisible();
  await expect(sizeSelect(page)).toContainText("Auto-detected · 300 × 250");
  await expect(page.locator(`img[src="${BANNER_URL}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".html5-banner-code")).toContainText("Shop now");
  await page.keyboard.press("Escape");
  await expect(bannerFrame(page)).toBeVisible();
});
