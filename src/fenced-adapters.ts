/**
 * The registry of bundled fenced-block adapters.
 *
 * Some Obsidian plugins store their data in a fenced block under their own
 * info string (` ```vtable `). The engine only learns standard markdown and
 * HTML, never another plugin's private format, so the translation happens here
 * at the edge, before `preprocessObsidian` runs.
 *
 * Adapters are bundled with this plugin and can be switched on and off in its
 * settings. Nothing is loaded at runtime from a third party: Obsidian's
 * community review rejects dynamically loaded code. A new adapter is a new
 * entry in {@link BUNDLED_ADAPTERS} plus its `toMarkdown`.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * fenced-adapters.test.ts).
 */

import { indentLines, replaceFencedBlocks } from "./fenced-blocks";
import { VTABLE_FENCE, vtableToMarkdown } from "./vtable";

/** A bundled translation of one third-party fenced-block format. */
export interface FencedAdapter {
  /** Stable settings key, stored in `data.json`. */
  id: string;
  /** Info-string name of the block it translates, lower-cased. */
  fence: string;
  /** Settings row title. */
  name: string;
  /** Settings row description. */
  description: string;
  /** Extra search terms for Obsidian's settings search. */
  aliases: readonly string[];
  /**
   * Translate the block's source to markdown or HTML. Null leaves the block
   * exactly as written, so invalid input still prints as a code block.
   */
  toMarkdown(source: string): string | null;
}

/** Every adapter bundled with the plugin, in settings order. */
export const BUNDLED_ADAPTERS: readonly FencedAdapter[] = [
  {
    id: "vtable",
    fence: VTABLE_FENCE,
    name: "Vtable tables",
    description:
      "Convert vtable fenced blocks written with the Vtable plugin into tables in the PDF. Vtable charts, diagonal cells and math are shown as text.",
    aliases: ["vtable", "table", "merged cells", "colspan", "rowspan"],
    toMarkdown: vtableToMarkdown,
  },
];

/** Per-adapter on/off switches, keyed by adapter id. */
export type FencedAdapterSettings = Record<string, boolean>;

/** Every bundled adapter on: the default for a new install and an upgrade. */
export function defaultFencedAdapterSettings(): FencedAdapterSettings {
  const settings: FencedAdapterSettings = {};
  for (const adapter of BUNDLED_ADAPTERS) settings[adapter.id] = true;
  return settings;
}

/**
 * Normalise what `data.json` holds into one boolean per bundled adapter.
 * `data.json` is user-editable, so a missing, malformed or stale value falls
 * back to that adapter's default (on) rather than throwing or inventing an
 * adapter that no longer exists.
 */
export function normalizeFencedAdapterSettings(stored: unknown): FencedAdapterSettings {
  const settings = defaultFencedAdapterSettings();
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return settings;
  }
  const record = stored as Record<string, unknown>;
  for (const adapter of BUNDLED_ADAPTERS) {
    const value = record[adapter.id];
    if (typeof value === "boolean") settings[adapter.id] = value;
  }
  return settings;
}

/** True unless the adapter was explicitly switched off. */
export function isAdapterEnabled(
  settings: FencedAdapterSettings | undefined,
  id: string,
): boolean {
  return settings?.[id] !== false;
}

/**
 * Translate every matching fenced block the enabled adapters understand,
 * leaving every other byte of the document untouched.
 */
export function applyFencedAdapters(
  markdown: string,
  settings: FencedAdapterSettings | undefined,
): string {
  const byFence = new Map<string, FencedAdapter>();
  for (const adapter of BUNDLED_ADAPTERS) {
    if (isAdapterEnabled(settings, adapter.id)) byFence.set(adapter.fence, adapter);
  }
  if (byFence.size === 0) return markdown;

  return replaceFencedBlocks(markdown, (block) => {
    const adapter = byFence.get(block.fence);
    if (adapter === undefined) return null;

    const output = adapter.toMarkdown(block.source);
    if (output === null) return null;

    // The block occupied whole lines, so its replacement must end with a
    // newline or the next line would join the last one.
    const text = output.endsWith("\n") ? output : `${output}\n`;
    return indentLines(text, block.indent);
  });
}
