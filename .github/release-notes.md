Adds a way to send feedback to the MakesPDF team.

- **Report problem.** When an export fails, the error notice has a
  **Report problem** link. It opens a short form; your message is sent with a
  few facts about the failure (HTTP status, error code, page size, and the
  size of the export request in bytes). The note's text, its path and your vault name are never sent.
- **Send feedback.** A new command and a button in the plugin settings open the
  same form, where you can send a problem, an idea or praise.

Feedback works without an API key. See the README's "Network use and privacy"
section for exactly what a feedback request contains.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
