/**
 * Tests for the canvas -> POST /api/v1/canvas request builder: what goes in
 * the `canvas`, `files` and `options` fields, and what stops a request from
 * being produced at all. The vault and the browser image APIs are fakes
 * (image-test-stubs.ts), so the real builder, preprocessor and inliner run.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANVAS_BODY_LIMIT,
  buildCanvasExport,
  type CanvasExportDeps,
  type CanvasVaultAdapter,
} from "./canvas";
import { bytesToDataUri } from "./image-encode";
import {
  fakeCanvasCalls,
  fakeDecode,
  fakeEncodedBytes,
  installImageStubs,
  makeFakeCanvas,
  uninstallImageStubs,
} from "./image-test-stubs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeVaultFile {
  extension: string;
  bytes?: ArrayBuffer;
  text?: string;
}

const vaultFiles = new Map<string, FakeVaultFile>();
const resolves: Array<[string, string]> = [];

const vault: CanvasVaultAdapter = {
  resolve: (linkpath, sourcePath) => {
    resolves.push([linkpath, sourcePath]);
    const entry = vaultFiles.get(linkpath);
    return entry ? { path: linkpath, extension: entry.extension } : null;
  },
  readText: async (file) => {
    const entry = vaultFiles.get(file.path);
    if (entry?.text === undefined) throw new Error(`missing text: ${file.path}`);
    return entry.text;
  },
  readBinary: async (file) => {
    const entry = vaultFiles.get(file.path);
    if (!entry?.bytes) throw new Error(`missing bytes: ${file.path}`);
    return entry.bytes;
  },
};

const tableCalls: string[] = [];

const deps: CanvasExportDeps = {
  vault,
  withPropertyTable: (markdown) => {
    tableCalls.push(markdown);
    return `[properties]\n${markdown}`;
  },
  createCanvas: makeFakeCanvas,
};

const options = { pageSize: "A4", fontFamily: "Inter", title: "Board" };

interface ParsedBody {
  canvas: { nodes: Array<Record<string, unknown>> };
  files?: Record<string, { data?: string; markdown?: string }>;
  options: { pageSize: string; fontFamily: string; title: string };
}

const bufferOf = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

const canvasTextOf = (nodes: unknown[]): string =>
  JSON.stringify({ nodes, edges: [] });

/** Run a successful build and parse the body. */
async function buildOk(
  canvasText: string,
  overrides?: Partial<CanvasExportDeps>,
): Promise<ParsedBody> {
  const result = await buildCanvasExport({
    canvasText,
    sourcePath: "Folder/Board.canvas",
    options,
    deps: { ...deps, ...overrides },
  });
  if (!result.ok) throw new Error(`build failed: ${result.message}`);
  return JSON.parse(result.body) as ParsedBody;
}

beforeEach(() => {
  vaultFiles.clear();
  resolves.length = 0;
  tableCalls.length = 0;
  installImageStubs();
});

afterEach(uninstallImageStubs);

// ---------------------------------------------------------------------------

describe("buildCanvasExport", () => {
  it("sends an image file node as a data URI under the canvas's exact path", async () => {
    vaultFiles.set("Attachments/photo.png", { extension: "png", bytes: bufferOf([80, 78, 71]) });
    fakeDecode.width = 800;
    fakeDecode.height = 600;

    const body = await buildOk(
      canvasTextOf([
        { id: "n1", type: "file", file: "Attachments/photo.png", x: 0, y: 0, width: 400, height: 300 },
      ]),
    );

    expect(body.files).toEqual({
      "Attachments/photo.png": { data: "data:image/png;base64,UE5H" },
    });
    expect(resolves).toEqual([["Attachments/photo.png", "Folder/Board.canvas"]]);
    // Already within 2400px: sent byte-for-byte, never through a canvas.
    expect(fakeCanvasCalls).toHaveLength(0);
  });

  it("sends a group background as a data URI", async () => {
    vaultFiles.set("cover.jpg", { extension: "jpg", bytes: bufferOf([1, 2, 3]) });
    fakeDecode.width = 1000;
    fakeDecode.height = 500;

    const body = await buildOk(
      canvasTextOf([{ id: "g", type: "group", background: "cover.jpg", x: 0, y: 0, width: 100, height: 100 }]),
    );

    expect(body.files?.["cover.jpg"]?.data).toBe(
      bytesToDataUri(new Uint8Array([1, 2, 3]), "image/jpeg"),
    );
  });

  it("downscales an image over 2400px before sending it", async () => {
    vaultFiles.set("huge.png", { extension: "png", bytes: bufferOf([5]) });
    // The stub decodes at 4800x2700 by default.
    const body = await buildOk(
      canvasTextOf([{ id: "n", type: "file", file: "huge.png", x: 0, y: 0, width: 10, height: 10 }]),
    );

    expect(body.files?.["huge.png"]?.data).toBe(
      bytesToDataUri(fakeEncodedBytes, "image/jpeg"),
    );
    expect(fakeCanvasCalls).toHaveLength(1);
    expect(fakeCanvasCalls[0].width).toBe(2400);
    expect(fakeCanvasCalls[0].height).toBe(1350);
  });

  it("sends a note file node as preprocessed markdown with images inlined", async () => {
    fakeDecode.width = 600;
    fakeDecode.height = 400;
    vaultFiles.set("notes/spec.md", {
      extension: "md",
      text: "---\ntitle: Spec\n---\n\nSee [[Other Note]] and ![[photo.png]]",
    });
    vaultFiles.set("photo.png", { extension: "png", bytes: bufferOf([80, 78, 71]) });

    const body = await buildOk(
      canvasTextOf([{ id: "n", type: "file", file: "notes/spec.md", x: 0, y: 0, width: 10, height: 10 }]),
    );

    const markdown = body.files?.["notes/spec.md"]?.markdown ?? "";
    // The "Properties to include" table, then the Obsidian-to-GFM pass...
    expect(markdown.startsWith("[properties]")).toBe(true);
    expect(markdown).toContain("See Other Note");
    expect(markdown).not.toContain("[[");
    // ...then the note's own images inlined, resolved relative to the note.
    // (The shared inliner rewrites every occurrence of the path, alt text
    // included — the same behaviour note exports have always had — so the
    // assertion is on the image destination.)
    expect(markdown).toContain("](data:image/png;base64,UE5H)");
    expect(tableCalls).toHaveLength(1);
    expect(resolves).toContainEqual(["photo.png", "notes/spec.md"]);
  });

  it("preprocesses text cards and inlines their embeds, leaving the input text untouched", async () => {
    fakeDecode.width = 600;
    fakeDecode.height = 400;
    vaultFiles.set("card.png", { extension: "png", bytes: bufferOf([80, 78, 71]) });
    const cardText = "# Card\n\nLink [[Page]]\n\n![[card.png]]";
    const raw = canvasTextOf([
      { id: "t", type: "text", text: cardText, x: 0, y: 0, width: 300, height: 200 },
    ]);

    const body = await buildOk(raw);

    const sent = body.canvas.nodes[0].text as string;
    expect(sent).toContain("Link Page");
    expect(sent).not.toContain("[[");
    expect(sent).toContain("](data:image/png;base64,UE5H)");
    // The builder transforms its own parsed copy only; the raw text it was
    // handed — and so the file on disk — is never modified.
    const rawParsed = JSON.parse(raw) as { nodes: Array<{ text: string }> };
    expect(rawParsed.nodes[0].text).toBe(cardText);
    expect(resolves).toContainEqual(["card.png", "Folder/Board.canvas"]);
  });

  it("omits unsupported file types and unresolvable paths", async () => {
    vaultFiles.set("report.pdf", { extension: "pdf", bytes: bufferOf([1]) });

    const body = await buildOk(
      canvasTextOf([
        { id: "a", type: "file", file: "report.pdf", x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "file", file: "missing.png", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );

    expect(body.files).toBeUndefined();
    expect(resolves.map(([path]) => path)).toEqual(["report.pdf", "missing.png"]);
  });

  it("sends each referenced path once, even when several nodes use it", async () => {
    vaultFiles.set("shared.png", { extension: "png", bytes: bufferOf([80, 78, 71]) });
    fakeDecode.width = 100;
    fakeDecode.height = 100;

    const body = await buildOk(
      canvasTextOf([
        { id: "a", type: "file", file: "shared.png", x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "file", file: "shared.png", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );

    expect(Object.keys(body.files ?? {})).toEqual(["shared.png"]);
    expect(resolves).toHaveLength(1);
  });

  it("forwards page size, font family and title as options", async () => {
    const body = await buildOk(canvasTextOf([]));
    expect(body.options).toEqual({ pageSize: "A4", fontFamily: "Inter", title: "Board" });
    expect(body.files).toBeUndefined();
  });

  it("refuses a body over the 25MB cap with a message instead of a request", async () => {
    // 20MB of bytes base64s to ~26.7MB, over the real 25MiB cap.
    vaultFiles.set("big.png", { extension: "png", bytes: new ArrayBuffer(20_000_000) });
    fakeDecode.width = 600;
    fakeDecode.height = 400;

    const result = await buildCanvasExport({
      canvasText: canvasTextOf([
        { id: "big", type: "file", file: "big.png", x: 0, y: 0, width: 10, height: 10 },
      ]),
      sourcePath: "Folder/Board.canvas",
      options,
      deps,
    });

    expect(CANVAS_BODY_LIMIT).toBe(25 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-large");
      expect(result.message).toContain("25MB");
      expect(result.message).toContain("try again");
    }
  });

  it("also refuses when only the final serialised body crosses the cap", async () => {
    const result = await buildCanvasExport({
      canvasText: canvasTextOf([]),
      sourcePath: "Folder/Board.canvas",
      options,
      deps: { ...deps, maxBodyBytes: 64 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
  });

  it("reports invalid JSON with a user-facing message", async () => {
    const result = await buildCanvasExport({
      canvasText: "definitely not json",
      sourcePath: "Folder/Board.canvas",
      options,
      deps,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
      expect(result.message).toBe(
        "The canvas file is not valid JSON. Open it in Obsidian and try again.",
      );
    }
  });
});
