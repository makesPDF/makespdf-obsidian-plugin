/**
 * Validation for the user-supplied output folder.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/**
 * Rejects output folders that try to escape the vault. The Vault API is
 * vault-relative and normalizePath() does not expand "~", so accepting these
 * silently creates a literal "~" or root-anchored folder inside the vault
 * instead of writing where the user expected.
 */
export function outputFolderError(value: string): string | undefined {
  const folder = value.trim();
  if (!folder) return undefined;
  if (folder === "~" || folder.startsWith("~/")) {
    return "PDFs are saved inside your vault, so \"~\" is not expanded. Use a folder in the vault instead.";
  }
  if (folder.startsWith("/")) {
    return "Use a path relative to your vault, without a leading slash.";
  }
  if (folder.split("/").includes("..")) {
    return "The output folder must stay inside your vault.";
  }
  return undefined;
}
