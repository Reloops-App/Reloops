import { expect, test } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => Boolean((window as any).reloopsTest));
});

test("PDF first page renders actual content into a bounded JPEG", async ({ page }) => {
  const result = await page.evaluate(async base64 => {
    const api = (window as any).reloopsTest;
    const blob = await api.generateThumbnailBlob(api.fromBase64(base64, "brief.pdf", "application/pdf"));
    if (!blob) throw new Error("No PDF thumbnail");
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { type: blob.type, width: bitmap.width, height: bitmap.height, colored: data.some((v, i) => i % 4 === 0 && Math.abs(v - data[i + 2]) > 40) };
  }, pdfFixture().toString("base64"));
  expect(result.type).toBe("image/jpeg");
  expect(result.width).toBeLessThanOrEqual(640);
  expect(result.height).toBeLessThanOrEqual(640);
  expect(result.colored).toBe(true);
});

test("PDFs with missing or generic MIME types still get previews", async ({ page }) => {
  for (const type of ["", "application/octet-stream"]) {
    expect(await page.evaluate(async ({ base64, type }) => {
      const api = (window as any).reloopsTest;
      return Boolean(await api.generateThumbnailBlob(api.fromBase64(base64, "brief.PDF", type)));
    }, { base64: pdfFixture().toString("base64"), type })).toBe(true);
  }
});

test("corrupt PDFs and unsupported file types fail gracefully", async ({ page }) => {
  expect(await page.evaluate(async () => {
    const api = (window as any).reloopsTest;
    return [await api.generateThumbnailBlob(new File(["broken"], "broken.pdf", { type: "application/pdf" })), await api.generateThumbnailBlob(new File(["text"], "notes.txt", { type: "text/plain" }))];
  })).toEqual([null, null]);
});

test("upload animation moves during transfer and thumbnail processing", async ({ page }) => {
  for (const phase of ["upload", "thumbnail"]) {
    await page.evaluate(phase => (window as any).reloopsTest.renderCard({ phase, progress: 100 }), phase);
    await expect(page.getByText(phase === "upload" ? "Uploading..." : "Generating thumbnail...")).toBeVisible();
    const bar = page.locator('.bg-primary\\/80');
    await expect(bar).toBeVisible();
    const before = await bar.evaluate(el => getComputedStyle(el).transform);
    await expect.poll(() => bar.evaluate(el => getComputedStyle(el).transform)).not.toBe(before);
    expect(await page.locator('[class*="slide-right-scan"]').evaluate(el => getComputedStyle(el).animationName)).toBe("slide-right-scan");
  }
});

test("cancel and completion controls render correctly in the browser", async ({ page }) => {
  await page.evaluate(() => (window as any).reloopsTest.renderCard({}));
  await page.getByRole("button", { name: "Cancel upload" }).click();
  expect(await page.evaluate(() => (window as any).reloopsTest.canceled)).toEqual(["test-upload"]);
  await page.evaluate(() => (window as any).reloopsTest.renderCard({ status: "completed", phase: "done" }));
  await expect(page.getByText("Upload complete")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel upload" })).toHaveCount(0);
});
