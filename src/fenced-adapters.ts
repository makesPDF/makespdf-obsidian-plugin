/**
 * The registry of bundled third-party format adapters.
 *
 * Some Obsidian plugins store their data in a fenced block under their own
 * info string (` ```vtable `). The engine only learns standard markdown and
 * HTML, never another plugin's private format, so the translation happens here
 * at the edge, before `preprocessObsidian` runs.
 *
 * Two kinds are bundled. A {@link FencedAdapter} owns one fenced block and
 * replaces it. A {@link MarkdownAdapter} instead reads the note's own
 * markdown, because its format lives in plain pipe tables rather than a
 * fence; it receives the whole document and masks fenced code itself.
 *
 * Adapters are bundled with this plugin and can be switched on and off in its
 * settings. Nothing is loaded at runtime from a third party: Obsidian's
 * community review rejects dynamically loaded code. A new adapter is a new
 * entry in {@link BUNDLED_ADAPTERS} or {@link BUNDLED_MARKDOWN_ADAPTERS} plus
 * its translation.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * fenced-adapters.test.ts).
 */

import { indentLines, replaceFencedBlocks } from "./fenced-blocks";
import {
  STRUCTURAL_TABLES_PLUGIN_ID,
  structuralTablesToMarkdown,
} from "./structural-tables";
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

/** Every fenced-block adapter bundled with the plugin, in settings order. */
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

/**
 * A bundled translation of a third-party format that lives in the note's
 * markdown rather than in a fenced block.
 *
 * `transform` receives the whole document and must leave fenced code alone;
 * {@link structuralTablesToMarkdown} does that with the same fence scan
 * `preprocessObsidian` uses.
 */
export interface MarkdownAdapter {
  /** Stable settings key, stored in `data.json`. */
  id: string;
  /**
   * Obsidian community-plugin id whose enablement turns this adapter on, so
   * a note that the plugin renders in Obsidian exports the same way here.
   */
  pluginId: string;
  /** Settings row title. */
  name: string;
  /** Settings row description. */
  description: string;
  /** Extra search terms for Obsidian's settings search. */
  aliases: readonly string[];
  /** Translate the note's markdown. */
  transform(markdown: string): string;
}

/** Every whole-document adapter bundled with the plugin, in settings order. */
export const BUNDLED_MARKDOWN_ADAPTERS: readonly MarkdownAdapter[] = [
  {
    id: STRUCTURAL_TABLES_PLUGIN_ID,
    pluginId: STRUCTURAL_TABLES_PLUGIN_ID,
    name: "Structural Tables pipe tables",
    description:
      "Convert Structural Tables pipe tables - merged cells, multi-row headers and row headers - into tables in the PDF. Turns on automatically while the Structural Tables plugin is enabled.",
    aliases: [
      "structural tables",
      "table",
      "merged cells",
      "colspan",
      "rowspan",
      "pipe table",
    ],
    transform: structuralTablesToMarkdown,
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

/**
 * True unless the adapter was explicitly switched off. `enabledByDefault` is
 * the adapter kind's default: a fenced adapter starts on, a whole-document
 * one starts off.
 */
export function isAdapterEnabled(
  settings: Record<string, boolean> | undefined,
  id: string,
  enabledByDefault = true,
): boolean {
  const value = settings?.[id];
  return typeof value === "boolean" ? value : enabledByDefault;
}

/** Per-adapter on/off switches for whole-document adapters, keyed by id. */
export type MarkdownAdapterSettings = Record<string, boolean>;

/**
 * Every whole-document adapter off: the default for a new install and an
 * upgrade. These formats share ordinary markdown syntax with every other
 * note, so they only run when the user asked for them - by enabling the
 * third-party plugin, or by turning the row on.
 */
export function defaultMarkdownAdapterSettings(): MarkdownAdapterSettings {
  const settings: MarkdownAdapterSettings = {};
  for (const adapter of BUNDLED_MARKDOWN_ADAPTERS) settings[adapter.id] = false;
  return settings;
}

/**
 * Normalise what `data.json` holds into one boolean per whole-document
 * adapter. As with the fenced adapters, a missing, malformed or stale value
 * falls back to that adapter's default (off).
 */
export function normalizeMarkdownAdapterSettings(
  stored: unknown,
): MarkdownAdapterSettings {
  const settings = defaultMarkdownAdapterSettings();
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return settings;
  }
  const record = stored as Record<string, unknown>;
  for (const adapter of BUNDLED_MARKDOWN_ADAPTERS) {
    const value = record[adapter.id];
    if (typeof value === "boolean") settings[adapter.id] = value;
  }
  return settings;
}

/** True when the user switched the adapter's own setting on. */
export function isMarkdownAdapterEnabled(
  settings: MarkdownAdapterSettings | undefined,
  adapter: MarkdownAdapter,
): boolean {
  return settings?.[adapter.id] === true;
}

/**
 * Translate every matching fenced block the enabled adapters understand,
 * leaving every other byte of the document untouched.
 *
 * `adapters` is a parameter for tests and future registries; the shipped
 * plugin always uses {@link BUNDLED_ADAPTERS}.
 */
export function applyFencedAdapters(
  markdown: string,
  settings: FencedAdapterSettings | undefined,
  adapters: readonly FencedAdapter[] = BUNDLED_ADAPTERS,
): string {
  const byFence = new Map<string, FencedAdapter>();
  for (const adapter of adapters) {
    if (isAdapterEnabled(settings, adapter.id)) byFence.set(adapter.fence, adapter);
  }
  if (byFence.size === 0) return markdown;

  return replaceFencedBlocks(markdown, (block) => {
    const adapter = byFence.get(block.fence);
    if (adapter === undefined) return null;

    let output: string | null;
    try {
      output = adapter.toMarkdown(block.source);
    } catch {
      // An adapter bug must not reject the whole export with no Notice and no
      // PDF: fall back to the block exactly as the user wrote it.
      return null;
    }
    if (output === null) return null;

    // The block occupied whole lines, so its replacement must end with a
    // newline or the next line would join the last one.
    const text = output.endsWith("\n") ? output : `${output}\n`;
    return indentLines(text, block.indent);
  });
}

/**
 * Translate the note's own markdown through every whole-document adapter that
 * is active: switched on in the settings, or owned by a third-party plugin
 * that is enabled right now.
 *
 * `isPluginEnabled` is a parameter so the registry stays free of the
 * `obsidian` import; `main.ts` supplies the structural `app.plugins` lookup.
 * Adapters run in order, and a throwing adapter leaves the document as it was
 * rather than rejecting the whole export.
 */
export function applyMarkdownAdapters(
  markdown: string,
  settings: MarkdownAdapterSettings | undefined,
  isPluginEnabled: (pluginId: string) => boolean,
  adapters: readonly MarkdownAdapter[] = BUNDLED_MARKDOWN_ADAPTERS,
): string {
  let result = markdown;
  for (const adapter of adapters) {
    if (!isMarkdownAdapterEnabled(settings, adapter) && !isPluginEnabled(adapter.pluginId)) {
      continue;
    }
    try {
      result = adapter.transform(result);
    } catch {
      // As with the fenced adapters: an adapter bug must not lose the export.
      continue;
    }
  }
  return result;
}
