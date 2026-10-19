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

  // ---- alt text (MAK-266) ------------------------------------------------

  it("leaves the alt text alone when the alt is the same as the path", async () => {
    // What preprocessObsidian produces for `![[photo.png]]`: the same string
    // in both slots. Replacing globally put the data URI in the alt too.
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const result = await inlineVaultImages(
      "![photo.png](photo.png)",
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe("![photo.png](data:image/png;base64,UE5H)");
  });

  it("does not send an inlined image twice", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const md = "![photo.png](photo.png)";
    const result = await inlineVaultImages(md, vault, resolveAttachment, "Board.md");

    expect(result.match(/data:image\/png;base64,UE5H/g)).toHaveLength(1);
  });

  it("leaves the alt of an <img src> tag alone", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const result = await inlineVaultImages(
      '<img src="photo.png" width="300" alt="photo.png">',
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe('<img src="data:image/png;base64,UE5H" width="300" alt="photo.png">');
  });

  it("still replaces every destination when one path is a prefix of another", async () => {
    const { vault, resolveAttachment } = makeVault({
      "a.png": { extension: "png", bytes: bytesOf("A") },
      "a.png.bak.png": { extension: "png", bytes: bytesOf("B") },
    });

    const result = await inlineVaultImages(
      "![a](a.png) ![b](a.png.bak.png)",
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe("![a](data:image/png;base64,QQ==) ![b](data:image/png;base64,Qg==)");
  });

  it("leaves a path mentioned in prose alone", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    const result = await inlineVaultImages(
      "The file photo.png is embedded below.\n\n![photo](photo.png)",
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe(
      "The file photo.png is embedded below.\n\n![photo](data:image/png;base64,UE5H)",
    );
  });

  it("leaves an alt that names a different inlineable image alone", async () => {
    const { vault, resolveAttachment } = makeVault({
      "thumb.png": { extension: "png", bytes: bytesOf("T") },
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    // thumb.png has to be referenced as a destination somewhere, or it never
    // reaches the map and the alt could not be swapped even by a blind
    // replace — the assertion would then hold for the wrong reason.
    const result = await inlineVaultImages(
      "![thumb.png](photo.png) and ![t](thumb.png)",
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe(
      "![thumb.png](data:image/png;base64,UE5H) and ![t](data:image/png;base64,VA==)",
    );
  });

  it("still inlines a destination that carries a title", async () => {
    const { vault, resolveAttachment } = makeVault({
      "photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    // The plain reference is what puts the path in the map; the titled one
    // must not be left behind pointing at the vault.
    const result = await inlineVaultImages(
      '![a](photo.png) ![b](photo.png "the photo")',
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe(
      '![a](data:image/png;base64,UE5H) ![b](data:image/png;base64,UE5H "the photo")',
    );
  });

  it("still inlines a titled destination whose path contains a space", async () => {
    const { vault, resolveAttachment } = makeVault({
      "my photo.png": { extension: "png", bytes: bytesOf("PNG") },
    });

    // `\S+` in the titled split stopped at the first space and left the
    // second destination un-inlined; the split has to be lazy instead.
    const result = await inlineVaultImages(
      '![a](my photo.png) ![b](my photo.png "the photo")',
      vault,
      resolveAttachment,
      "Board.md",
    );

    expect(result).toBe(
      '![a](data:image/png;base64,UE5H) ![b](data:image/png;base64,UE5H "the photo")',
    );
  });
});
