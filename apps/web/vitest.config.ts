import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      // This is coverage of the initial tested modules, not the whole app.
      include: [
        "src/lib/privateAssetUrl.ts", "src/lib/guestUploadRows.ts",
        "src/lib/shareLinkPassword.ts", "src/lib/shareGuestIdentity.ts",
        "src/lib/assetUtils.ts", "src/hooks/useFileUpload.ts",
        "src/components/file-upload-utils.ts", "src/components/upload/UploadProgressCard.tsx",
      ],
      thresholds: {
        statements: 65, branches: 80, functions: 75, lines: 65,
        "src/lib/privateAssetUrl.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/lib/guestUploadRows.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/lib/shareLinkPassword.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
