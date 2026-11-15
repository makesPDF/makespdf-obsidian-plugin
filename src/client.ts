/**
 * How this plugin identifies itself to the makesPDF API.
 *
 * Official clients send a plain kind and version in `X-MakesPDF-Client`
 * (`<kind>/<version>`); the server matches those kinds exactly and keeps
 * `obsidian-plugin` only as an alias for already-installed versions (operator
 * decision 2f382669). One shared constant and one value builder, so the render
 * and feedback requests cannot drift. Free of the `obsidian` import so the
 * header rules are unit-testable.
 */

import { normalizeApiKey } from "./api-key";

/** This plugin's client kind on the wire: one plain word, no suffix. */
export const CLIENT_KIND = "obsidian";

/** The `X-MakesPDF-Client` value: `obsidian/<manifest version>`. */
export function clientHeaderValue(version: string): string {
  return `${CLIENT_KIND}/${version}`;
}

/**
 * Headers for the POST /api/v1/md render request. A pasted key often carries
 * whitespace, which is never part of it, so the header is built from the
 * trimmed value; a whitespace-only key is no key at all and leaves the request
 * anonymous rather than sending a `Bearer ` that can only 401.
 */
export function buildRenderHeaders(args: {
  version: string;
  apiKey: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MakesPDF-Client": clientHeaderValue(args.version),
  };
  const apiKey = normalizeApiKey(args.apiKey);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}
