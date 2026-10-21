import { describe, expect, it } from "vitest";
import { buildRecursiveFolderAssetCounts, compareMimeKinds, groupByRoot, mimeKind, nextVersionForRootFromMap, normalizeAsset, normalizeAssets } from "../../src/lib/assetUtils";

describe("asset organization", () => {
  it("groups versions by original and sorts version number before date", () => {
    const rows = [
      { id: "root", version_no: 1, createdAt: "2026-01-03" },
      { id: "v2-old", parent_asset_id: "root", version_no: 2, createdAt: "2026-01-01" },
      { id: "v2-new", parent_asset_id: "root", version_no: 2, createdAt: "2026-01-02" },
      { id: "unknown", parent_asset_id: "root" },
      { id: "separate", parent_asset_id: "" },
    ];
    const groups = groupByRoot(rows);
    expect(groups.get("root")?.map(r => r.id)).toEqual(["v2-new", "v2-old", "root", "unknown"]);
    expect(groups.get("separate")).toEqual([rows[4]]);
    expect(nextVersionForRootFromMap("root", groups)).toBe(3);
    expect(nextVersionForRootFromMap("missing", groups)).toBe(1);
    expect(rows[0].id).toBe("root");
  });
  it("counts descendants once, including cyclic and missing folder parents", () => {
    const counts = buildRecursiveFolderAssetCounts(
      [{ folder_id: "child" }, { folder_id: "parent" }, {}, { folder_id: "orphan" }, { folder_id: "loop" }],
      [{ id: "parent" }, { id: "child", parent_folder_id: "parent" }, { id: "loop", parent_folder_id: "loop" }],
    );
    expect(Object.fromEntries(counts)).toEqual({ null: 5, child: 1, parent: 2, orphan: 1, loop: 1 });
  });
  it("normalizes database fields without losing smart metadata or version ancestry", () => {
    const input = { id: "a", title: "brief.pdf", mime_type: "application/pdf", size_bytes: 123, storage_path: "ws/a.pdf", cover_image_url: "cover", parent_asset_id: 10, folder_id: 20, project_id: 30, smart_tags: ["brief"], smart_description: "A brief", tags: "invalid" };
    expect(normalizeAsset(input)).toMatchObject({ name: "brief.pdf", type: "application/pdf", sizeBytes: 123, url: "ws/a.pdf", coverUrl: "cover", parent_asset_id: "10", folder_id: "20", project_id: "30", smart_tags: ["brief"], smart_description: "A brief", tags: [] });
    expect(normalizeAssets(undefined)).toEqual([]);
    expect(normalizeAssets([input])).toHaveLength(1);
    expect(normalizeAsset({ id: "empty" })).toMatchObject({ tags: [], smart_tags: [], folder_id: null, parent_asset_id: null });
  });
  it("sorts PDF, media, and unknown MIME kinds consistently", () => {
    expect(mimeKind()).toBe("other");
    expect(mimeKind("application/pdf")).toBe("pdf");
    expect(compareMimeKinds("image/png", "application/pdf")).toBeLessThan(0);
    expect(compareMimeKinds("application/pdf", "text/plain")).toBeLessThan(0);
    expect(compareMimeKinds("image/png", "image/jpeg")).toBe(0);
    expect(compareMimeKinds("x-custom/a", "video/mp4")).toBeGreaterThan(0);
  });
});
