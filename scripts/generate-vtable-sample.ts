/**
 * Regenerates docs/vtable-sample.pdf, the sample export of the Vtable adapter.
 *
 * The fixture note runs through the plugin's own modules in the order
 * `exportToPdf` in src/main.ts runs them: title heading, fenced-block
 * adapters (with the default settings, so **Vtable tables** is on),
 * Obsidian-to-GFM conversion, image inlining. The note has no embeds, so
 * main.ts's resolveNoteEmbeds step, which needs a real vault, is skipped.
 *
 * The render is sent with no API key, as generate-example-export.ts does, so
 * the PDF carries the anonymous-caller footer.
 *
 *   npm run generate:vtable-sample
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildRenderHeaders } from "../src/client";
import { applyFencedAdapters, defaultFencedAdapterSettings } from "../src/fenced-adapters";
import { inlineVaultImages } from "../src/images";
import { withNoteTitle } from "../src/note-title";
import { preprocessObsidian } from "../src/preprocess";

const API_URL = process.env.MAKESPDF_API_URL ?? "https://makespdf.com";
const NOTE_PATH = "docs/example-note/Vtable Tables.md";
const NOTE_TITLE = "Vtable Tables";
const OUTPUT_PDF = "docs/vtable-sample.pdf";

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
  markdown = applyFencedAdapters(markdown, defaultFencedAdapterSettings());
  markdown = preprocessObsidian(markdown);
  markdown = await inlineVaultImages(
    markdown,
    { readBinary: () => Promise.reject(new Error("the sample note has no local images")) },
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
  const warnings = response.headers.get("X-Layout-Warnings");
  if (warnings) console.warn(`Layout warnings: ${warnings}`);

  writeFileSync(OUTPUT_PDF, Buffer.from(await response.arrayBuffer()));
  console.log(`Wrote ${OUTPUT_PDF}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
