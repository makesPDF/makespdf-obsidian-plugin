Callout titles now appear in the callout header, next to its icon.

## Fixes

- **Callout titles stay in the header.** A callout with a title, such as
  `> [!info] Details`, used to export with the type name ("Note") in the
  header and the title on a separate line below it. The title now replaces
  the type name in the header, as it does in Obsidian, and the header shows
  an icon for the callout type. Callouts without a title show the type name
  with its icon.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
