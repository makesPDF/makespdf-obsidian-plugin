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

/** This plugin's client kind on the wire: one plain word, no suffix. */
export const CLIENT_KIND = "obsidian";

/** The `X-MakesPDF-Client` value: `obsidian/<manifest version>`. */
export function clientHeaderValue(version: string): string {
  return `${CLIENT_KIND}/${version}`;
}

/** Headers for the POST /api/v1/md render request. */
export function buildRenderHeaders(args: {
  version: string;
  apiKey: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MakesPDF-Client": clientHeaderValue(args.version),
  };
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;
  return headers;
}
