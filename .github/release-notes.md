Export Obsidian canvas boards to PDF, and send feedback to the MakesPDF team.

## Canvas boards (.canvas)

- **Export a canvas.** With a `.canvas` board open, the ribbon button or the
  new **Export current canvas to PDF** command turns the whole board into one
  tagged, accessible PDF (PDF/A-2A and PDF/UA-1). Cards keep their board
  positions, and their text is real, selectable document content, styled like
  Obsidian's own canvas.
- **Everything on the board comes along.** Text cards, linked notes (a
  `#Heading` or `#^blockid` subpath renders just that section or block),
  images, SVGs, group labels, colours and backgrounds, link cards and labelled
  connectors.
- **PDFs on the board are embedded as vector pages.** A `#page=N` subpath
  picks the page. Up to 10 PDFs per board, 5MB each; a PDF over a limit, or
  one that cannot be embedded, renders as a placeholder card instead of
  failing the export.
- **Long cards are not cut off.** A card whose text does not fit is shrunk a
  little, then continued on its own page, linked to and from the board.
- **Emoji and CJK text render.** Emoji in colour; Chinese, Japanese and Korean
  text without installing a font.
- Canvas exports use your **Page size** and **Font family** settings. Requests
  are capped at 25MB and boards at 60 images. See the README's "Canvas boards"
  section for the full list of limits.

## Feedback

- **Report problem.** When an export fails, the error notice has a
  **Report problem** link. It opens a short form; your message is sent with a
  few facts about the failure (HTTP status, error code, page size, and the
  size of the export request in bytes). The note's text, its path and your
  vault name are never sent.
- **Send feedback.** A new command and a button in the plugin settings open
  the same form, where you can send a problem, an idea or praise. Feedback
  works without an API key.
- Exports and feedback identify the plugin to the makesPDF API in the
  `X-MakesPDF-Client` header (`obsidian/<version>`), so renders can be
  attributed to the Obsidian plugin. See the README's "Network use and
  privacy" section for exactly what each request contains.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
