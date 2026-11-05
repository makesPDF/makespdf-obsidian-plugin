Images whose file names contain parentheses now appear in the PDF.

## Fixes

- **Image file names with parentheses.** An embed such as
  `![[Photo (2024).jpg]]` printed as text in the PDF instead of showing the
  image. Export the note again and the image appears. Names containing `<` or
  `>`, and standard images written as `![alt](a(b).png)`, work too.

An embedded image that is not in your vault now leaves a gap in the PDF, where
some names used to print as text.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
