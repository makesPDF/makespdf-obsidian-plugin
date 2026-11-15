/**
 * The makesPDF API key's shape, and when the settings tab warns about it.
 *
 * makesPDF API keys and device-flow tokens are both `mpdf_` followed by 32
 * alphanumeric characters (`apps/web/src/server/api-keys.ts` and
 * `device-flow.ts` in lecstor/makespdf). This is a hint, not a rule: a
 * self-hosted deployment mints its own tokens, so an API URL override turns
 * the check off, and a key that fails it is still saved and still sent
 * (MAK-323). Free of the `obsidian` import so the rules are unit-testable;
 * `main.ts` only draws the result.
 */

/** The hosted service. An empty API URL setting means this one. */
export const DEFAULT_API_URL = "https://makespdf.com";

/** Every hosted API key and device-flow token: `mpdf_` + 32 alphanumerics. */
export const API_KEY_SHAPE = /^mpdf_[A-Za-z0-9]{32}$/;

/** The inline warning under the API key field. */
export const API_KEY_FORMAT_WARNING =
  "This doesn't look like a makesPDF API key. Keys start with mpdf_.";

/** Surrounding whitespace is never part of a key: trim before checking or sending. */
export function normalizeApiKey(apiKey: string): string {
  return apiKey.trim();
}

/**
 * True when the API URL setting does not override the hosted service: empty
 * (the default) or the hosted URL itself, with or without a trailing slash.
 */
export function isDefaultApiUrl(apiUrl: string): boolean {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed === "" || trimmed.toLowerCase() === DEFAULT_API_URL;
}

/** The two settings the warning depends on. */
export interface ApiKeySettings {
  apiKey: string;
  apiUrl: string;
}

/**
 * The warning to show under the API key field, or undefined when there is
 * nothing to say: no key at all, an API URL override (whose tokens are
 * arbitrary strings), or a key in the hosted service's format.
 */
export function apiKeyFormatWarning(settings: ApiKeySettings): string | undefined {
  const key = normalizeApiKey(settings.apiKey);
  if (!key) return undefined;
  if (!isDefaultApiUrl(settings.apiUrl)) return undefined;
  return API_KEY_SHAPE.test(key) ? undefined : API_KEY_FORMAT_WARNING;
}
