Release assets are now built in GitHub Actions and carry a [build provenance
attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds),
so `main.js` can be cryptographically verified as having been built from this
repository:

```
gh attestation verify main.js --repo makesPDF/makespdf-obsidian-plugin
```

No functional changes to the plugin since 1.0.0.
