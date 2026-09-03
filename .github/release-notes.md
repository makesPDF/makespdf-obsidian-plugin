Addresses the community directory review of 1.0.1. No user-facing behaviour
changes; the plugin does the same thing, more correctly.

- `minAppVersion` raised to 1.4.0. It was 1.0.0, but `Vault.createFolder` has
  only had its current form since 1.4.0, so the declared minimum was a promise
  the plugin could not keep on older versions.
- Settings are now declared with the `getSettingDefinitions()` API added in
  Obsidian 1.13.0, so they appear in settings search. The imperative `display()`
  implementation remains as the fallback for versions older than 1.13.0, which
  is the supported way to cover both.
- Error responses from the API are parsed defensively instead of trusting the
  shape of the JSON body.
- Stored settings are read as a partial rather than as `any`.
- Removed the deprecated `setDynamicTooltip()` call.
- The repository now runs `eslint-plugin-obsidianmd` in CI, the same rule set
  the directory reviews against.

Release assets carry a build provenance attestation:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```
