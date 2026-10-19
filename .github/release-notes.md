Images in notes export again, and the note's title is printed at the top of the PDF.

## Fixes

- **Image embeds render.** In 1.1.0 an Obsidian image embed such as
  `![[photo.png]]` exported as the line *See: photo.png* instead of the image.
  Embedded images now appear in the PDF again, on desktop and mobile.
- **Image alt text is the file name.** An embedded image's alt text in the
  tagged PDF is the image's file name, which is what screen readers announce.
  It was previously replaced by the image data itself.

## Note title

- **The title is printed as the top heading.** A note export now starts with
  the note's file name as a top-level heading, the same title Obsidian shows
  above the body. It goes below any frontmatter and above the
  **Properties to include** table, matching Obsidian's reading view.
- If a note already opens with its own `# heading`, the PDF has both, as
  Obsidian's reading view does.
- A `title` key in the note's frontmatter does not replace the printed title
  or the PDF's document title; both use the file name. See the README's
  "The note title" section.

Canvas exports are unchanged.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
