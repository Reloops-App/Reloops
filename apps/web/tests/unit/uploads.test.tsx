import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileUpload } from "../../src/hooks/useFileUpload";
import { UploadProgressCard } from "../../src/components/upload/UploadProgressCard";
import { generateThumbnailBlob, getFilesFromEvent, getRelativeFilePath, inferFileContentType, isSuspiciouslySmall, maxBytesForMime, type UploadItem } from "../../src/components/file-upload-utils";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), insert: vi.fn(), edge: vi.fn(), thumb: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({
  getSessionToken: vi.fn(),
  supabase: {
    storage: { from: (bucket: string) => ({ upload: (...args: unknown[]) => mocks.upload(bucket, ...args), getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }) }) },
    from: () => ({ insert: mocks.insert }),
    auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
  },
}));
vi.mock("@/api/edge", () => ({ invokeEdgeFunction: mocks.edge }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("../../src/components/file-upload-utils", async (original) => ({ ...await original<object>(), generateThumbnailBlob: mocks.thumb }));

let root: Root;
let host: HTMLDivElement;
let hook: ReturnType<typeof useFileUpload>;
let onUploaded: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.thumb.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
  mocks.edge.mockResolvedValue({ data: { data: [] }, error: null });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); onUploaded = vi.fn();
  function Harness() { hook = useFileUpload({ workspaceId: "workspace", projectId: "project", onUploaded }); return null; }
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const add = async (files: File[]) => { await act(async () => { hook.addFiles(files); }); };
const pdf = () => new File(["%PDF-1.4 test"], "brief.pdf", { type: "application/pdf" });

describe("member uploads", () => {
  it("uploads the original, saves a PDF cover, then publishes the completed asset", async () => {
    await add([pdf()]);
    expect(mocks.upload.mock.calls.map(c => c[0])).toEqual(["assets", "thumbnails"]);
    expect(generateThumbnailBlob).toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ mime_type: "application/pdf", uploaded_by: "member", cover_image_url: expect.stringContaining("/thumbnails/"), thumbnail_path: expect.stringContaining("workspace/") }));
    expect(hook.completedUploads).toHaveLength(1);
    expect(hook.activeUploads).toHaveLength(0);
    expect(onUploaded).toHaveBeenCalledOnce();
    await act(async () => hook.clearCompleted());
    expect(hook.uploads).toEqual([]);
  });
  it("still completes when a thumbnail cannot be generated", async () => {
    mocks.thumb.mockRejectedValue(new Error("Invalid PDF"));
    await add([pdf()]);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ cover_image_url: null, thumbnail_path: null }));
    expect(hook.completedUploads).toHaveLength(1);
  });
  it("does not publish an asset when original storage fails", async () => {
    mocks.upload.mockResolvedValue({ error: new Error("Storage unavailable") });
    await add([pdf()]);
    expect(hook.uploads[0]).toMatchObject({ status: "error", errorMessage: "Storage unavailable" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    await act(async () => hook.clearCompleted());
    expect(hook.uploads).toHaveLength(1); // Keep errors visible for the user.
  });
  it("surfaces database failures rather than reporting success", async () => {
    mocks.insert.mockResolvedValue({ error: new Error("Permission denied") });
    await add([pdf()]);
    expect(hook.uploads[0].status).toBe("error");
    expect(onUploaded).not.toHaveBeenCalled();
  });
  it("deduplicates files within and across selection batches", async () => {
    await add([pdf(), pdf()]);
    await add([pdf()]);
    expect(hook.uploads).toHaveLength(1);
    expect(hook.skippedNames).toEqual(["brief.pdf"]);
    expect(onUploaded).toHaveBeenCalledOnce();
  });
  it("rejects oversized documents and tiny placeholder media before storage", async () => {
    const large = pdf(); Object.defineProperty(large, "size", { value: 256 * 1024 * 1024 + 1 });
    await add([large, new File(["tiny"], "shortcut.mp4")]);
    expect(hook.uploads.every(u => u.status === "error")).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not finalize a canceled upload when storage eventually resolves", async () => {
    let finish!: (result: { error: null }) => void;
    mocks.upload.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await add([pdf()]);
    const id = hook.uploads[0].id;
    await act(async () => hook.cancelUpload(id));
    await act(async () => finish({ error: null }));
    expect(hook.uploads[0].status).toBe("canceled");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    await act(async () => hook.removeUpload(id));
    expect(hook.uploads).toEqual([]);
  });
  it("does not publish an upload canceled during thumbnail generation", async () => {
    let finish!: (blob: Blob) => void;
    mocks.thumb.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await add([pdf()]);
    expect(hook.uploads[0].phase).toBe("thumbnail");
    await act(async () => hook.cancelUpload(hook.uploads[0].id));
    await act(async () => finish(new Blob(["cover"])));
    expect(hook.uploads[0].status).toBe("canceled");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });
  it("reuses nested folders for a folder upload", async () => {
    mocks.edge.mockImplementation(async (_name, { body }) => ({ data: { data: body.action === "list_folders" ? [{ id: "existing", name: "Campaign", parent_folder_id: null }] : { id: "created", name: body.name } }, error: null }));
    const file = pdf(); Object.defineProperty(file, "webkitRelativePath", { value: "Campaign/Briefs/brief.pdf" });
    await add([file]);
    expect(mocks.edge.mock.calls.filter(c => c[1].body.action === "create_folder")).toHaveLength(1);
    expect(mocks.edge).toHaveBeenCalledWith("asset", expect.objectContaining({ body: expect.objectContaining({ name: "Briefs", parent_folder_id: "existing" }) }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ folder_id: "created" }));
  });
});

describe("file selection", () => {
  it.each([["brief.PDF", "", "application/pdf"], ["brief.pdf", "application/octet-stream", "application/pdf"], ["clip.mov", "", "video/quicktime"], ["a.bin", "", "application/octet-stream"], ["a.png", "image/png", "image/png"]])("infers %s with browser MIME %s", (name, type, expected) => {
    expect(inferFileContentType({ name, type })).toBe(expected);
  });
  it("allows full documents while flagging placeholder images and videos", () => {
    expect(maxBytesForMime("application/pdf")).toBe(256 * 1024 * 1024);
    expect(isSuspiciouslySmall(pdf()).suspicious).toBe(false);
    expect(isSuspiciouslySmall(new File(["x"], "a.png", { type: "image/png" })).suspicious).toBe(true);
    expect(isSuspiciouslySmall(new File([new Uint8Array(5000)], "a.mp4")).suspicious).toBe(false);
  });
  it("reads all directory batches and preserves paths", async () => {
    const file = pdf(); let batch = 0;
    const entry = { isDirectory: true, isFile: false, name: "Folder", createReader: () => ({ readEntries: (done: (entries: unknown[]) => void) => done(batch++ === 0 ? [{ isFile: true, isDirectory: false, name: file.name, file: (done: (file: File) => void) => done(file) }] : []) }) };
    const files = await getFilesFromEvent({ dataTransfer: { items: [{ kind: "file", webkitGetAsEntry: () => entry }] } } as any);
    expect(files).toEqual([file]);
    expect(getRelativeFilePath(file)).toBe("Folder/brief.pdf");
  });
});

describe("upload card", () => {
  const item = { id: "upload", file: pdf(), name: "brief.pdf", type: "application/pdf", size: 123, progress: 100, status: "uploading", phase: "thumbnail", relativePath: "Campaign/brief.pdf" } as UploadItem;
  it("shows thumbnail processing, folder context, and cancellation", async () => {
    const cancel = vi.fn();
    await act(async () => root.render(<UploadProgressCard item={item} onCancel={cancel} />));
    expect(host.textContent).toContain("Generating thumbnail...");
    expect(host.textContent).toContain("Campaign");
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Cancel upload"]')!.click());
    expect(cancel).toHaveBeenCalledWith("upload");
  });
  it.each([["completed", "Upload complete"], ["error", "Upload failed"], ["canceled", "Canceled"]] as const)("shows %s without a cancel button", async (status, text) => {
    await act(async () => root.render(<UploadProgressCard item={{ ...item, status, coverUrl: "https://storage.test/cover.jpg", errorMessage: status === "error" ? "Storage unavailable" : undefined }} onCancel={vi.fn()} />));
    expect(host.textContent).toContain(text);
    expect(host.querySelector('button[title="Cancel upload"]')).toBeNull();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://storage.test/cover.jpg");
    if (status === "error") expect(host.textContent).toContain("Storage unavailable");
  });
});
