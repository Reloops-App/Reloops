import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pdfFixture } from "./pdf-fixture";

test("member and guest PDF uploads persist publicly loadable thumbnails", async ({ page, browser }) => {
  if (process.env.RELOOPS_TEST_DOCKER === "1") test.setTimeout(180_000);
  const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anon || serviceKey.includes("replace-with-local")) throw new Error("Start local Supabase and run pnpm sync-env before integration tests.");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const client = createClient(url, anon, { auth: { persistSession: false } });
  let userId: string | undefined, workspaceId: string | undefined, organizationId: string | undefined;
  const guestContext = await browser.newContext();
  try {
    const email = `browser-pdf-${crypto.randomUUID()}@example.test`, password = "Browser-PDF-password-1";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error; userId = created.data.user.id;
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const boot = await client.functions.invoke("bootstrap", { body: {} });
    if (boot.error) throw boot.error; workspaceId = boot.data.data.workspace_id;
    const workspace = await admin.from("workspaces").select("organization_id").eq("id", workspaceId!).single();
    if (workspace.error) throw workspace.error; organizationId = workspace.data.organization_id;
    const projects = await client.from("projects").select("id").eq("workspace_id", workspaceId!).limit(1).single();
    if (projects.error) throw projects.error;
    const authKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    await page.addInitScript(({ authKey, session }) => localStorage.setItem(authKey, JSON.stringify(session)), { authKey, session: signed.data.session });
    await page.goto(`/workspace/${workspaceId}/projects/${projects.data.id}`);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached" });
    await fileInput.setInputFiles({ name: "member-thumbnail-check.pdf", mimeType: "application/pdf", buffer: pdfFixture() });
    await expect(page.getByText("member-thumbnail-check.pdf", { exact: true }).first()).toBeVisible();
    await expect.poll(async () => {
      const result = await admin.from("assets").select("id").eq("workspace_id", workspaceId!).eq("title", "member-thumbnail-check.pdf");
      if (result.error) throw result.error;
      return result.data?.length;
    }).toBe(1);
    const uploadedResult = await admin.from("assets").select("id").eq("workspace_id", workspaceId!).eq("title", "member-thumbnail-check.pdf").single();
    if (uploadedResult.error) throw uploadedResult.error;
    const uploaded = uploadedResult.data;
    const row = await admin.from("assets").select("cover_image_url,thumbnail_path,storage_path").eq("id", uploaded.id).single();
    if (row.error) throw row.error;
    expect(row.data.thumbnail_path).toBeTruthy();
    expect((await page.request.get(row.data.cover_image_url)).ok()).toBe(true);
    await expect.poll(async () => {
      const result = await admin.from("assets").select("smart_description,smart_tags,ai_metadata").eq("id", uploaded.id).single();
      if (result.error) throw result.error;
      return result.data;
    }, { timeout: 20_000 }).toMatchObject({ smart_description: expect.stringContaining("member-thumbnail-check.pdf"), smart_tags: expect.arrayContaining(["pdf"]), ai_metadata: expect.objectContaining({ provider: "mock", model: "mock" }) });
    await page.goto(`/workspace/${workspaceId}/projects/${projects.data.id}/assets/${uploaded.id}`);
    await expect(page.locator(".react-pdf__Page__canvas").first()).toBeVisible();
    await test.step("asset share shows existing member comments to guests", async () => {
      const profile = await admin.from("profiles").update({ display_name: "Member Annotation Author" }).eq("id", userId!);
      if (profile.error) throw profile.error;
      const drawing = { page: 1, strokes: [{ tool: "pen", color: "#ff7a00", points: [{ x: 0.4, y: 0.4 }] }] };
      const comment = await client.functions.invoke("comment", { body: { asset_id: uploaded.id, body: "Existing member feedback on this PDF", ms_offset: 1200, drawing_json: drawing } });
      if (comment.error) throw comment.error;
      expect(comment.data.data).toMatchObject({ ms_offset: 1200, drawing_json: drawing });
      const legacy = await admin.from("asset_comments").insert({ asset_id: uploaded.id, author_user_id: userId!, body: "Legacy member annotation", media_ms: 2400, marker: drawing });
      if (legacy.error) throw legacy.error;
      const assetShare = await client.functions.invoke("share", { body: { action: "create-asset-share-link", asset_id: uploaded.id, allow_comments: true } });
      if (assetShare.error) throw assetShare.error;
      const sharedPage = await guestContext.newPage();
      const responsePromise = sharedPage.waitForResponse(r => r.url().includes("/functions/v1/comment?") && r.request().method() === "GET");
      await sharedPage.goto(`/share/${assetShare.data.data.token ?? assetShare.data.data.id}`);
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      expect(payload.profiles[userId!].display_name).toBe("Member Annotation Author");
      expect(payload.data.find((row: any) => row.body === "Legacy member annotation")).toMatchObject({ ms_offset: 2400, drawing_json: drawing });
      await expect(sharedPage.getByText("Member Annotation Author", { exact: true }).first()).toBeVisible();
      await expect(sharedPage.locator('button[title="Existing member feedback on this PDF (drag to move)"]')).toBeVisible();
      await expect(sharedPage.locator('button[title="Legacy member annotation (drag to move)"]')).toBeVisible();
      await expect(sharedPage.getByText("Existing member feedback on this PDF", { exact: true }).first()).toBeVisible();
      await sharedPage.reload();
      await expect(sharedPage.getByText("Existing member feedback on this PDF", { exact: true }).first()).toBeVisible();
      await sharedPage.close();
    });
    const share = await client.functions.invoke("project-share", { body: { action: "create", project_id: projects.data.id, allow_upload: true } });
    if (share.error) throw share.error;
    await guestContext.addInitScript(() => localStorage.setItem("share_guest_identity", JSON.stringify({ name: "PDF Guest", email: "pdf-guest@example.test", authorToken: "browser-test-author-token-12345678901234567890" })));
    const guest = await guestContext.newPage();
    await guest.goto(`/share/project/${share.data.data.id}`);
    const input = guest.locator('input[type="file"]');
    await input.waitFor({ state: "attached" });
    const previewPromise = guest.waitForResponse(r => r.url().includes("/project-share-upload") && r.request().postDataJSON()?.action === "set-preview");
    await input.setInputFiles({ name: "guest-thumbnail-check.pdf", mimeType: "application/pdf", buffer: pdfFixture() });
    const preview = await previewPromise;
    expect(preview.ok()).toBe(true);
    const cover = (await preview.json()).cover_image_url;
    expect((await guest.request.get(cover)).ok()).toBe(true);
    await guest.reload();
    await expect(guest.getByText("guest-thumbnail-check.pdf", { exact: true }).first()).toBeVisible();
    await expect(guest.locator(`img[src="${cover}"]`).first()).toBeVisible();
    if (process.env.RELOOPS_TEST_DOCKER === "1") {
      await test.step("Docker restart preserves uploaded files, thumbnails, and share links", async () => {
        execFileSync(process.env.DOCKER_BINARY || "docker", ["compose", "restart", "reloops"], { stdio: "pipe", timeout: 60_000 });
        await expect.poll(async () => {
          try { return (await page.request.get("/healthz")).status(); } catch { return 0; }
        }, { timeout: 120_000 }).toBe(200);
        await guest.reload();
        await expect(guest.locator(`img[src="${cover}"]`).first()).toBeVisible();
        await page.reload();
        await expect(page.locator(".react-pdf__Page__canvas").first()).toBeVisible();
        const signedFile = await client.storage.from("assets").createSignedUrl(row.data.storage_path, 60);
        if (signedFile.error) throw signedFile.error;
        expect((await page.request.get(signedFile.data.signedUrl)).ok()).toBe(true);
      });
    }
  } finally {
    await guestContext.close();
    if (workspaceId) {
      const rows = await admin.from("assets").select("id,storage_path").eq("workspace_id", workspaceId);
      if (rows.data?.length) {
        await admin.storage.from("assets").remove(rows.data.map(r => r.storage_path));
        await admin.storage.from("thumbnails").remove(rows.data.map(r => `${workspaceId}/${r.id}.jpg`));
      }
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
