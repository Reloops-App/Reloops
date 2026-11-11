import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHtml5BannerAsset } from "../../src/lib/html5Banner";
import { fetchTextResource } from "../../src/lib/fetchTextResource";
import Html5BannerCodeView from "../../src/components/review/Html5BannerCodeView";

const SOURCE = `<!doctype html>\n<html><body><h1 class="x">Hi</h1></body></html>`;

describe("isHtml5BannerAsset", () => {
  it.each([
    [{ mime_type: "text/html" }, true],
    [{ mime_type: " TEXT/HTML " }, true],
    [{ storage_path: "ws/project/Banner.HTML" }, true],
    [{ storage_path: "ws/project/banner.htm" }, true],
    [{ url: "https://cdn.test/banner.html?token=abc" }, true],
    [{ title: "summer-sale.html" }, true],
    [{ mime_type: "image/png", storage_path: "ws/hero.png" }, false],
    [{ storage_path: "ws/notes.html.zip" }, false],
    [{ storage_path: "ws/page.xhtml.txt" }, false],
    [null, false],
  ])("%j → %s", (asset, expected) => {
    expect(isHtml5BannerAsset(asset)).toBe(expected);
  });
});

describe("fetchTextResource", () => {
  it("fetches with CORS and no credentials, forwarding the abort signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(SOURCE, { status: 200 }));
    const controller = new AbortController();
    await expect(fetchTextResource("https://cdn.test/a.html", { signal: controller.signal })).resolves.toBe(SOURCE);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/a.html", { method: "GET", mode: "cors", credentials: "omit", signal: controller.signal });
  });

  it("throws with the status on a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(fetchTextResource("https://cdn.test/a.html")).rejects.toThrow("Failed to fetch resource (403)");
  });
});

describe("Html5BannerCodeView", () => {
  let host: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.spyOn>;
  let writeText: ReturnType<typeof vi.fn>;

  const render = async (props: React.ComponentProps<typeof Html5BannerCodeView>) => {
    await act(async () => root.render(<Html5BannerCodeView {...props} />));
  };
  const waitFor = async (check: () => boolean, timeout = 5000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error(`Timed out. DOM:\n${host.innerHTML.slice(0, 500)}`);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
  };
  const button = (label: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(SOURCE, { status: 200 }));
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows a loading state, then the highlighted source with the file name from the URL", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = () => resolve(new Response(SOURCE)); }));
    await render({ htmlUrl: "https://cdn.test/ws/Summer%20Sale.html?sig=1", title: "Fallback title" });
    expect(host.textContent).toContain("Loading source...");
    expect(button("Copy")?.disabled).toBe(true);

    release();
    await waitFor(() => Boolean(host.querySelector("pre.shiki")));
    expect(host.textContent).toContain("Summer Sale.html");
    expect(host.textContent).not.toContain("Loading source...");
    expect(host.querySelectorAll(".html5-banner-code .line")).toHaveLength(2);
    // Source is rendered as text, never injected as live markup.
    expect(host.querySelector(".html5-banner-code h1")).toBeNull();
    expect(host.querySelector(".html5-banner-code")?.textContent).toContain('<h1 class="x">Hi</h1>');
  });

  it("falls back to the title, then index.html, when the URL has no usable file name", async () => {
    await render({ htmlUrl: "/relative/path/", title: "My banner" });
    await waitFor(() => Boolean(host.querySelector("pre.shiki")));
    expect(host.textContent).toContain("My banner");

    await render({ htmlUrl: "/relative/path/" });
    expect(host.textContent).toContain("index.html");
  });

  it("copies the raw source and briefly confirms", async () => {
    await render({ htmlUrl: "https://cdn.test/a.html" });
    await waitFor(() => button("Copy")?.disabled === false);
    await act(async () => button("Copy")!.click());
    expect(writeText).toHaveBeenCalledWith(SOURCE);
    expect(button("Copied")).toBeDefined();
    await waitFor(() => Boolean(button("Copy")), 3000);
  });

  it("shows an error with Retry and Back to preview when the source can't load", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("err", { status: 500 }));
    const onExit = vi.fn();
    await render({ htmlUrl: "https://cdn.test/a.html", onExit });
    await waitFor(() => host.textContent!.includes("Couldn't load the banner source."));
    expect(button("Copy")?.disabled).toBe(true);

    await act(async () => button("Back to preview")!.click());
    expect(onExit).toHaveBeenCalledTimes(1);

    await act(async () => button("Retry")!.click());
    await waitFor(() => Boolean(host.querySelector("pre.shiki")));
    expect(host.textContent).not.toContain("Couldn't load");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hides Back to preview when no exit handler is given", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("err", { status: 500 }));
    await render({ htmlUrl: "https://cdn.test/a.html" });
    await waitFor(() => Boolean(button("Retry")));
    expect(button("Back to preview")).toBeUndefined();
  });
});
