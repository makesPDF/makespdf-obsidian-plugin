Vtable tables from the third-party Vtable plugin now print as real tables.

## What's new

- **Vtable tables.** A `vtable` fenced block written with the
  [Vtable](https://community.obsidian.md/plugins/vtable) plugin is translated
  into a real table in the PDF: merged cells keep their row and column spans,
  the first row becomes the table header, and cell alignment and background
  colours carry over. Formulas are calculated before the table is sent.
  Charts, diagonal split cells and math print as text with a note under the
  table. **Vtable tables** is on by default and can be switched off in the
  settings; invalid JSON still prints as a code block.
- **A notice when characters are missing.** If a character in the note or
  canvas has no font coverage, the PDF is still saved, and the save notice
  says so with a link to the font docs.
- **A clearer API key warning.** A key that does not look like a makesPDF key
  is flagged in the settings without blocking the export, and a 401 on export
  now names the key as invalid.

## Fixes

- Obsidian syntax inside a fenced code block (`[[wikilinks]]`,
  `==highlights==`, `#tags`, `%%comments%%`) is no longer converted: a code
  block prints exactly as written.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
