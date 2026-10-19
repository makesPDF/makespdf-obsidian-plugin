/**
 * Regenerates docs/example-export.png, the README's sample note export.
 *
 * The fixture note runs through the plugin's own modules in the order
 * `exportToPdf` in src/main.ts runs them, so the sample cannot drift from the
 * shipped pipeline: title heading, Obsidian-to-GFM conversion, image inlining.
 * (The note has no embeds, so main.ts's resolveNoteEmbeds step, which needs a
 * real vault, would be a no-op and is skipped. It has no local images either,
 * but the inliner is still called so the script follows the real path.)
 *
 * The render is sent with no API key on purpose: the `makespdf.com` footer in
 * the image is the anonymous-caller watermark, and the README describes an
 * export with the default settings.
 *
 * Needs network access to the API and `pdftoppm` (poppler) on PATH.
 *
 *   npm run generate:example-export
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRenderHeaders } from "../src/client";
import { inlineVaultImages } from "../src/images";
import { withNoteTitle } from "../src/note-title";
import { preprocessObsidian } from "../src/preprocess";

const API_URL = process.env.MAKESPDF_API_URL ?? "https://makespdf.com";
const NOTE_PATH = "docs/example-note/Q3 Field Notes.md";
const NOTE_TITLE = "Q3 Field Notes";
const OUTPUT_PNG = "docs/example-export.png";
// 139 dpi rasterises an A4 page (595x842 pt) to 1149x1626 px.
const DPI = "139";

// The render options of DEFAULT_SETTINGS in src/main.ts. Copied rather than
// imported because main.ts imports `obsidian`, which only exists inside the app.
const DEFAULT_RENDER_OPTIONS = {
  pageSize: "A4",
  fontFamily: "Inter",
  fontSize: 10,
  margins: [40, 40, 40, 40],
};

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string };
  const raw = readFileSync(NOTE_PATH, "utf8");

  let markdown = withNoteTitle(raw, NOTE_TITLE);
  markdown = preprocessObsidian(markdown);
  markdown = await inlineVaultImages(
    markdown,
    { readBinary: () => Promise.reject(new Error("the example note has no local images")) },
    () => null,
    `${NOTE_TITLE}.md`,
  );

  const response = await fetch(`${API_URL}/api/v1/md`, {
    method: "POST",
    headers: buildRenderHeaders({ version: manifest.version, apiKey: "" }),
    body: JSON.stringify({
      markdown,
      options: { ...DEFAULT_RENDER_OPTIONS, title: NOTE_TITLE },
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/v1/md returned ${response.status}: ${await response.text()}`);
  }

  const workDir = mkdtempSync(join(tmpdir(), "example-export-"));
  try {
    const pdfPath = join(workDir, "example-export.pdf");
    writeFileSync(pdfPath, Buffer.from(await response.arrayBuffer()));
    // -singlefile writes <prefix>.png rather than <prefix>-1.png.
    execFileSync("pdftoppm", [
      "-png", "-r", DPI, "-f", "1", "-l", "1", "-singlefile",
      pdfPath, OUTPUT_PNG.replace(/\.png$/, ""),
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`Wrote ${OUTPUT_PNG}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
