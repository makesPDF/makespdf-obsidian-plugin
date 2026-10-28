Note exports can print page numbers in the footer, and a failed export now says why.

## Page numbers

- **New settings: Page numbers and Page number position.** Choose a format
  (*Page 3 of 12*, *3 / 12* or *3*) and put it at the left, center or right
  of the footer. Page numbers are off by default, so existing exports are
  unchanged until you pick a format.
- **Per-note frontmatter works too.** With the setting off, a note can turn
  page numbers on for itself with `pageNumbers` and `pageNumberPosition`
  properties. When the setting is on, it applies to every note export and
  takes precedence over a note's own properties. See the README's
  "Page numbers" section.

Canvas exports are unchanged.

## Fixes

- **Export errors show the server's message.** A failed export used to show
  only an error code, such as *page-cap-exceeded*. The notice now shows the
  explanation the server returns, including the page count and the limit.
- **The "Open settings" link opens settings.** The link in the page-limit,
  rate-limit and file-size notices now opens the settings window on the
  MakesPDF tab. Previously the click closed the notice and nothing opened.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
