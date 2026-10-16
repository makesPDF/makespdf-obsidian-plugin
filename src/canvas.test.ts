/**
 * Tests for the canvas -> POST /api/v1/canvas request builder: what goes in
 * the `canvas`, `files` and `options` fields, and what stops a request from
 * being produced at all. The vault and the browser image APIs are fakes
 * (image-test-stubs.ts), so the real builder, preprocessor and inliner run.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANVAS_BODY_LIMIT,
  CANVAS_JSON_LIMIT,
  MAX_CANVAS_PDF_BYTES,
  MAX_CANVAS_PDFS,
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
const binaryReads: string[] = [];

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
    binaryReads.push(file.path);
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
  binaryReads.length = 0;
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

  it("sends a PDF file node as a data URI under its path", async () => {
    const pdfBytes = bufferOf([37, 80, 68, 70]);

    vaultFiles.set("docs/report.pdf", { extension: "pdf", bytes: pdfBytes });

    const body = await buildOk(
      canvasTextOf([
        { id: "n", type: "file", file: "docs/report.pdf", x: 0, y: 0, width: 400, height: 300 },
      ]),
    );

    expect(body.files).toEqual({
      "docs/report.pdf": { data: bytesToDataUri(new Uint8Array(pdfBytes), "application/pdf") },
    });
    expect(resolves).toEqual([["docs/report.pdf", "Folder/Board.canvas"]]);
    // Byte-for-byte: a PDF never goes near the image encoder.
    expect(fakeCanvasCalls).toHaveLength(0);
  });

  it("sends a PDF once for a whole-file and a #page=2 node, leaving the subpath on the node", async () => {
    const pdfBytes = bufferOf([37, 80, 68, 70]);
    vaultFiles.set("docs/report.pdf", { extension: "pdf", bytes: pdfBytes });
    const nodes = [
      { id: "whole", type: "file", file: "docs/report.pdf", x: 0, y: 0, width: 400, height: 300 },
      {
        id: "page2",
        type: "file",
        file: "docs/report.pdf",
        subpath: "#page=2",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      },
    ];
    const raw = canvasTextOf(nodes);

    const body = await buildOk(raw);

    expect(Object.keys(body.files ?? {})).toEqual(["docs/report.pdf"]);
    expect(binaryReads).toEqual(["docs/report.pdf"]);
    // The server reads `#page=2` from the board itself.
    expect(body.canvas.nodes[1].subpath).toBe("#page=2");
    // Only the parsed copy is transformed; the vault's canvas text is not.
    const onDisk = JSON.parse(raw) as { nodes: unknown[] };
    expect(onDisk.nodes).toEqual(nodes);
    expect(raw).not.toContain("data:");
  });

  it("omits a PDF over 5MB without failing the export", async () => {
    vaultFiles.set("big.pdf", {
      extension: "pdf",
      bytes: new ArrayBuffer(MAX_CANVAS_PDF_BYTES + 1),
    });
    vaultFiles.set("small.pdf", { extension: "pdf", bytes: bufferOf([37, 80, 68, 70]) });

    const body = await buildOk(
      canvasTextOf([
        { id: "big", type: "file", file: "big.pdf", x: 0, y: 0, width: 10, height: 10 },
        { id: "small", type: "file", file: "small.pdf", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );

    expect(MAX_CANVAS_PDF_BYTES).toBe(5 * 1024 * 1024);
    // Over-size is skipped, not read into the request; the rest still goes.
    expect(Object.keys(body.files ?? {})).toEqual(["small.pdf"]);
  });

  it("omits the 11th PDF — past the 10 PDFs a canvas may carry — without failing the export", async () => {
    const nodes: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 11; i++) {
      vaultFiles.set(`p${i}.pdf`, { extension: "pdf", bytes: bufferOf([37, 80, 68, 70]) });
      nodes.push({ id: `p${i}`, type: "file", file: `p${i}.pdf`, x: 0, y: 0, width: 10, height: 10 });
    }

    const body = await buildOk(canvasTextOf(nodes));

    expect(MAX_CANVAS_PDFS).toBe(10);
    expect(Object.keys(body.files ?? {})).toEqual([
      "p1.pdf",
      "p2.pdf",
      "p3.pdf",
      "p4.pdf",
      "p5.pdf",
      "p6.pdf",
      "p7.pdf",
      "p8.pdf",
      "p9.pdf",
      "p10.pdf",
    ]);
    // The 11th is never read: the budget is spent before the vault is hit.
    expect(binaryReads).toHaveLength(10);
  });

  it("omits a PDF that does not resolve in the vault", async () => {
    const body = await buildOk(
      canvasTextOf([
        { id: "n", type: "file", file: "missing.pdf", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );

    expect(body.files).toBeUndefined();
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

  it("keeps ^block-id markers in a note file node, but strips them from text cards", async () => {
    // The server resolves a card's `#^key-block` subpath by finding the
    // marker in the note text in `files`, then strips it from the rendered
    // block. A text card has no subpaths, so its marker must not print.
    vaultFiles.set("notes/spec.md", {
      extension: "md",
      text: "# Spec\n\nThe paragraph. ^key-block\n\nAfter.",
    });

    const body = await buildOk(
      canvasTextOf([
        { id: "t", type: "text", text: "Card paragraph. ^card-block", x: 0, y: 0, width: 300, height: 100 },
        {
          id: "n",
          type: "file",
          file: "notes/spec.md",
          subpath: "#^key-block",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
        },
      ]),
    );

    expect(body.canvas.nodes[0].text).toBe("Card paragraph.");
    expect(body.files?.["notes/spec.md"]?.markdown).toContain("The paragraph. ^key-block");
    // The subpath still rides on the node; the server applies it.
    expect(body.canvas.nodes[1].subpath).toBe("#^key-block");
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
    vaultFiles.set("recording.m4a", { extension: "m4a", bytes: bufferOf([1]) });

    const body = await buildOk(
      canvasTextOf([
        { id: "a", type: "file", file: "recording.m4a", x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "file", file: "missing.png", x: 0, y: 0, width: 10, height: 10 },
      ]),
    );

    expect(body.files).toBeUndefined();
    expect(resolves.map(([path]) => path)).toEqual(["recording.m4a", "missing.png"]);
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

  it("refuses a board whose inlined card embed pushes the canvas over the 2MB cap", async () => {
    // A card embedding a 1.6MB image base64s inside the canvas JSON to well
    // over the 2MB the service caps the document at (this is the shape that
    // reaches the server as a 400 "canvas ... exceeds the 2MB limit").
    vaultFiles.set("big.png", { extension: "png", bytes: new ArrayBuffer(1_600_000) });

    const result = await buildCanvasExport({
      canvasText: canvasTextOf([
        { id: "t", type: "text", text: "![[big.png]]", x: 0, y: 0, width: 300, height: 200 },
      ]),
      sourcePath: "Folder/Board.canvas",
      options,
      deps,
    });

    expect(CANVAS_JSON_LIMIT).toBe(2 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("canvas-too-large");
      expect(result.message).toContain("2MB");
      expect(result.message).toContain("try again");
    }
  });

  it("refuses an over-cap board before reading any referenced files", async () => {
    vaultFiles.set("photo.png", { extension: "png", bytes: bufferOf([80, 78, 71]) });

    const result = await buildCanvasExport({
      canvasText: canvasTextOf([
        { id: "t", type: "text", text: "card", x: 0, y: 0, width: 10, height: 10 },
        { id: "f", type: "file", file: "photo.png", x: 0, y: 0, width: 10, height: 10 },
      ]),
      sourcePath: "Folder/Board.canvas",
      options,
      deps: { ...deps, maxCanvasJsonChars: 32 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("canvas-too-large");
    // The canvas cap is checked before the files loop runs at all.
    expect(resolves).toHaveLength(0);
  });

  it("keys a note file node by node.file and leaves subpath on the node", async () => {
    vaultFiles.set("notes/spec.md", {
      extension: "md",
      text: "# Spec\n\nBody text.",
    });

    const body = await buildOk(
      canvasTextOf([
        {
          id: "n",
          type: "file",
          file: "notes/spec.md",
          subpath: "#Spec",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
        },
      ]),
    );

    // The files key is the exact node.file; the subpath rides on the node
    // and is applied by the server to the whole note this sends.
    expect(Object.keys(body.files ?? {})).toEqual(["notes/spec.md"]);
    expect(body.canvas.nodes[0].subpath).toBe("#Spec");
    expect(body.files?.["notes/spec.md"]?.markdown).toContain("Body text.");
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
