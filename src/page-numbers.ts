/**
 * Footer page-number options for note exports.
 *
 * MAK-226 added two keys to `POST /api/v1/md`: `pageNumbers` (absent means no
 * footer) and `pageNumberPosition` (default `right` when a format is set).
 * This module holds the plugin's spelling of those values and maps a stored
 * setting pair to the request options, so the mapping is unit-testable without
 * the `obsidian` import (see page-numbers.test.ts).
 *
 * The plugin sends the options only when the format is on. With the default
 * "Off" it sends neither key, which leaves a note's own `pageNumbers:` /
 * `pageNumberPosition:` frontmatter in charge: the API reads those keys and
 * its documented precedence gives explicit body options the last word. So an
 * explicit plugin setting wins over the note, exactly as the `title` option
 * does, and "Off" is the per-note route rather than a hard disable.
 */

/** Page-number formats, labelled the way the /markdown tool labels them. */
export const PAGE_NUMBER_FORMATS = {
  off: "Off",
  "page-n-of-total": "Page 3 of 12",
  "n-of-total": "3 / 12",
  n: "3",
} as const;

/** A stored `pageNumbers` setting: an API format, or the plugin's "Off". */
export type PageNumberFormat = keyof typeof PAGE_NUMBER_FORMATS;

/** Footer positions, in the order the settings dropdown shows them. */
export const PAGE_NUMBER_POSITIONS = {
  right: "Right",
  center: "Center",
  left: "Left",
} as const;

/** A stored `pageNumberPosition` setting: one of the API's positions. */
export type PageNumberPosition = keyof typeof PAGE_NUMBER_POSITIONS;

/** The page-number fields of the API's markdown `options` object. */
export interface PageNumberOptions {
  pageNumbers?: Exclude<PageNumberFormat, "off">;
  pageNumberPosition?: PageNumberPosition;
}

/** The note's own export options, everything except the page-number fields. */
export interface NoteExportOptions {
  pageSize: string;
  fontFamily: string;
  fontSize: number;
  margins: [number, number, number, number];
}

/** True for a value this plugin can send as `pageNumbers`. */
export function isPageNumberFormat(value: unknown): value is PageNumberFormat {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PAGE_NUMBER_FORMATS, value)
  );
}

/** True for a value this plugin can send as `pageNumberPosition`. */
export function isPageNumberPosition(value: unknown): value is PageNumberPosition {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PAGE_NUMBER_POSITIONS, value)
  );
}

/**
 * The `options.pageNumbers` and `options.pageNumberPosition` fields for one
 * note export, from the stored settings.
 *
 * Off, or a format this plugin does not know (a hand-edited `data.json`),
 * returns no fields at all: the API would reject an unknown body value with a
 * 400, while an absent one means "no footer" and leaves frontmatter in
 * charge. An unknown position is omitted so the API's own default (`right`)
 * applies, and a position is never sent without a format because the API
 * ignores it then.
 */
export function pageNumberOptions(
  format: unknown,
  position: unknown,
): PageNumberOptions {
  if (!isPageNumberFormat(format) || format === "off") return {};

  return {
    pageNumbers: format,
    ...(isPageNumberPosition(position) ? { pageNumberPosition: position } : {}),
  };
}

/**
 * The complete `options` object for one note export: the typography and title
 * options plus the page-number fields when the format is on.
 *
 * `main.ts` sends this straight through as the request body's `options`, so
 * the page-number keys are assembled in one tested place rather than spread
 * into the body by hand: a misplaced spread would put them at the body root,
 * where the API strips them and the footer silently never prints.
 */
export function buildExportOptions(
  core: NoteExportOptions,
  title: string,
  format: unknown,
  position: unknown,
): NoteExportOptions & { title: string } & PageNumberOptions {
  return { ...core, title, ...pageNumberOptions(format, position) };
}
