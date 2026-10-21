import { expect, test } from "@playwright/test";

test("audio preview decodes a real waveform and supports play, pause, and mute", async ({ page }) => {
  page.setDefaultTimeout(5000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const rate = 8000, samples = rate * 3;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 440 * Math.PI * 2) * 12000), 44 + i * 2);
  await page.route("**/test-tone.wav", route => route.fulfill({ contentType: "audio/wav", body: wav }));
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => Boolean((window as any).reloopsTest));
  await page.evaluate(() => (window as any).reloopsTest.renderAudio("/test-tone.wav"));
  await expect(page.getByText("Waveform", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator("canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, i) => i % 4 === 3 && value > 0);
  })).toBe(true);
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.15);
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("volume", 0);
});
