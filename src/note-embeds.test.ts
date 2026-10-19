/**
 * Tests for note-embed resolution.
 *
 * The image-embed cases are the regression guard for MAK-266: a trailing
 * fallback in this function used to convert the image embeds it deliberately
 * skips into `*See: image.png*`, so `preprocessObsidian` and
 * `inlineVaultImages` downstream never saw an image to inline. Every
 * `![[image.png]]` in an exported note printed as literal text.
 *
 * The vault and link resolver arrive as structural arguments (see
 * note-embeds.ts), so the real function runs here with no Obsidian.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_EMBED_DEPTH,
  resolveNoteEmbeds,
  type VaultNoteFile,
} from "./note-embeds";
import { preprocessObsidian } from "./preprocess";
import { inlineVaultImages } from "./images";

function makeVault(notes: Record<string, string>) {
  const files = new Map<string, VaultNoteFile>();
  for (const path of Object.keys(notes)) files.set(path, { path });

  return {
    vault: {
      read: async (file: VaultNoteFile) => notes[file.path] ?? "",
    },
    resolveLink: (linkpath: string) => files.get(linkpath) ?? null,
  };
}

async function run(md: string, notes: Record<string, string> = {}) {
  const { vault, resolveLink } = makeVault(notes);
  return resolveNoteEmbeds(md, vault, resolveLink, "source.md");
}

/**
 * The note-export pipeline as main.ts runs it: resolve embeds, convert
 * Obsidian syntax to GFM, then inline local images. The composed cases use
 * it so they cover the real interaction, not just this module in isolation.
 */
async function runExportPipeline(md: string, notes: Record<string, string> = {}) {
  const { vault, resolveLink } = makeVault(notes);
  let out = await resolveNoteEmbeds(md, vault, resolveLink, "source.md");
  out = preprocessObsidian(out);
  out = await inlineVaultImages(
    out,
    {
      readBinary: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    },
    (linkpath) =>
      // Every jpg in the fixtures resolves; anything else does not.
      linkpath.endsWith(".jpg") ? { path: linkpath, extension: "jpg" } : null,
    "source.md",
  );
  return out;
}

describe("resolveNoteEmbeds", () => {
  it("inlines a note embed", async () => {
    const out = await run("before ![[Other]] after", { Other: "the other note" });
    expect(out).toBe("before \n\nthe other note\n\n after");
  });

  it("inlines just the requested heading section", async () => {
    const out = await run("![[Other#Section]]", {
      Other: "# Other\n\nintro\n\n## Section\n\nwanted\n\n## Later\n\nunwanted",
    });
    expect(out).toContain("wanted");
    expect(out).not.toContain("unwanted");
  });

  it("inlines just the requested block", async () => {
    const out = await run("![[Other#^abc]]", {
      Other: "first line\n\nthe target line ^abc\n\nlast line",
    });
    expect(out).toContain("the target line");
    expect(out).not.toContain("first line");
  });

  it("strips frontmatter from an embedded note", async () => {
    const out = await run("![[Other]]", { Other: "---\ntitle: x\n---\n\nbody only" });
    expect(out).toContain("body only");
    expect(out).not.toContain("title: x");
  });

  it("reports an embed that does not resolve", async () => {
    expect(await run("see ![[Nope]]")).toBe("see *[not found: Nope]*");
  });

  it("stops at the depth limit", async () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i <= MAX_EMBED_DEPTH + 1; i++) notes[`n${i}`] = `n${i} ![[n${i + 1}]]`;
    const out = await run("![[n0]]", notes);
    expect(out).toContain(`*[embed depth limit: n${MAX_EMBED_DEPTH}]*`);
  });

  it("reports a circular embed", async () => {
    const out = await run("![[A]]", { A: "a ![[B]]", B: "b ![[A]]" });
    expect(out).toContain("*[circular embed: A]*");
  });

  // ---- image embeds (regression: MAK-266) --------------------------------

  it("leaves a plain image embed untouched for the image pass", async () => {
    expect(await run("here is an image\n![[photo.png]]")).toBe("here is an image\n![[photo.png]]");
  });

  it("leaves a sized image embed untouched", async () => {
    expect(await run("![[photo.png|400]]")).toBe("![[photo.png|400]]");
    expect(await run("![[photo.png|400x200]]")).toBe("![[photo.png|400x200]]");
  });

  it("leaves every supported image extension untouched", async () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"]) {
      const md = `![[photo.${ext}]]`;
      expect(await run(md)).toBe(md);
    }
  });

  it("never emits a See: reference for an image embed", async () => {
    const out = await run("![[photo.png]] ![[photo.jpg|400]]");
    expect(out).not.toContain("See:");
  });

  it("leaves an image embed beside a note embed that does resolve", async () => {
    const out = await run("![[photo.png]]\n![[Other]]", { Other: "embedded" });
    expect(out).toContain("![[photo.png]]");
    expect(out).toContain("embedded");
  });

  it("carries an image embed out of an embedded note for the image pass", async () => {
    // preprocessObsidian runs on embedded content too, so the inner embed is
    // already `![inner.png](inner.png)` here — still a markdown image for the
    // inliner that runs over the whole string afterwards.
    const out = await run("![[Other]]", { Other: "text ![[inner.png]]" });
    expect(out).toContain("![inner.png](inner.png)");
    expect(out).not.toContain("See:");
  });

  // ---- the composed export pipeline --------------------------------------

  it("turns a plain image embed into an inlined image", async () => {
    const out = await runExportPipeline("here is an image\n![[photo.jpg]]");
    expect(out).toContain("data:image/jpeg;base64,");
    expect(out).not.toContain("See:");
  });

  it("turns a sized image embed into a sized inlined image", async () => {
    const out = await runExportPipeline("![[photo.jpg|400]]");
    expect(out).toContain('src="data:image/jpeg;base64,');
    expect(out).toContain('width="400"');
    expect(out).not.toContain("See:");
  });

  it("inlines an image that follows an inlined note embed", async () => {
    const out = await runExportPipeline("![[Other]]\n\n![[photo.jpg]]", { Other: "note body" });
    expect(out).toContain("note body");
    expect(out).toContain("data:image/jpeg;base64,");
  });
});
