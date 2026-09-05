Fixes an output-folder bug found in testing.

Setting the output folder to a path outside the vault, such as `~/Downloads`,
silently created a folder literally named `~` inside the vault and wrote the PDF
there. PDFs are created through Obsidian's vault API, which is vault-relative
and does not expand `~`, so such a path can never mean what it looks like it
means.

Paths that try to leave the vault (`~`, a leading `/`, or `..` traversal) are now
rejected with an explanation, both in settings and at export time, and the
setting description says that the folder is inside your vault.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
