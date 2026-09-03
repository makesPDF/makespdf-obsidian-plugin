import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

// Mirrors the rule set the Obsidian community directory runs against
// submissions, so review findings surface locally instead of after a release.
// Build tooling (*.mjs) is excluded: it runs in Node at build time, never in
// the Obsidian runtime, so neither the mobile-API rules nor the plugin rules
// are meaningful there.
export default tseslint.config(
  { ignores: ["main.js", "node_modules/**", "*.mjs"] },

  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
