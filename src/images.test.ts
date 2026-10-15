/**
 * Tests for vault image inlining (note and canvas exports share it).
 */
import { describe, expect, it } from "vitest";

import { inlineVaultImages, type VaultImageFile } from "./images";

interface FakeVaultFile {
  extension: string;
  bytes?: ArrayBuffer;
}

/** A fake vault + resolver that records what was asked for. */
function makeVault(files: Record<string, FakeVaultFile>) {
  const reads: string[] = [];
  const resolves: Array<[string, string]> = [];
  return {
    reads,
    resolves,
    vault: {
      readBinary: async (file: VaultImageFile) => {
        reads.push(file.path);
        const entry = files[file.path];
        if (!entry?.bytes) throw new Error(`missing: ${file.path}`);
        return entry.bytes;
      },
    },
    resolveAttachment: (linkpath: string, sourcePath: string): VaultImageFile | null => {
      resolves.push([linkpath, sourcePath]);
      const entry = files[linkpath];
      return entry ? { path: linkpath, extension: entry.extension } : null;
    },
  };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

describe("inlineVaultImages", () => {
  it("replaces a local markdown image with a data URI", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const result = await inlineVaultImages(
      "before ![photo](photo.png) after",
      vault,
      resolveAttachment,
      "Folder/Board.md",
    );

    expect(result).toBe("before ![photo](data:image/png;base64,UE5H) after");
  });

  it("replaces paths inside <img src> tags too", async () => {
    const { vault, resolveAttachment } = makeVault({
      "logo.svg": { extension: "svg", bytes: bytesOf("<svg/>") },
    });

    const result = await inlineVaultImages(
      '<img src="logo.svg" width="300" alt="logo">',
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toContain('src="data:image/svg+xml;base64,');
  });

  it("resolves each reference against the given source path", async () => {
    const { vault, resolveAttachment, resolves } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    await inlineVaultImages(
      "![a](photo.png)",
      vault,
      resolveAttachment,
      "Folder/Board.canvas",
    );

    expect(resolves).toEqual([["photo.png", "Folder/Board.canvas"]]);
  });

  it("leaves remote URLs and data URIs untouched", async () => {
    const { vault, resolveAttachment, resolves } = makeVault({});
    const md =
      "![remote](https://example.com/a.png) ![inline](data:image/png;base64,AAA)";

    expect(await inlineVaultImages(md, vault, resolveAttachment, "Board.md")).toBe(md);
    expect(resolves).toEqual([]);
  });

  it("leaves an unresolvable local path as written", async () => {
    const { vault, resolveAttachment } = makeVault({});

    const md = "![gone](missing.png)";
    expect(await inlineVaultImages(md, vault, resolveAttachment, "Board.md")).toBe(md);
  });

  it("skips files whose extension has no image MIME type", async () => {
    const { vault, resolveAttachment, reads } = makeVault({
      "notes/todo.txt": { extension: "txt", bytes: bytesOf("todo") },
    });

    const md = "![todo](notes/todo.txt)";
    expect(await inlineVaultImages(md, vault, resolveAttachment, "Board.md")).toBe(md);
    expect(reads).toEqual([]);
  });

  it("leaves the path when the read fails", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png" }, // resolves but cannot be read
    });

    const md = "![photo](photo.png)";
    expect(await inlineVaultImages(md, vault, resolveAttachment, "Board.md")).toBe(md);
  });

  it("handles an image used more than once", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const result = await inlineVaultImages(
      "![a](photo.png) ![b](photo.png)",
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe(
      "![a](data:image/png;base64,UE5H) ![b](data:image/png;base64,UE5H)",
    );
  });
});
