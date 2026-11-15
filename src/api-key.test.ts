/**
 * Tests for the API key format hint: the hosted service's key shape, the
 * default-URL condition, and the whitespace handling the request relies on.
 */
import { describe, it, expect } from "vitest";

import {
  API_KEY_FORMAT_WARNING,
  API_KEY_SHAPE,
  DEFAULT_API_URL,
  apiKeyFormatWarning,
  isDefaultApiUrl,
  normalizeApiKey,
  normalizeApiSettings,
  type ApiKeySettings,
} from "./api-key";

/** A well-formed key: `mpdf_` plus 32 alphanumerics. */
const KEY = `mpdf_${"a1B2".repeat(8)}`;

/** A stored settings object the way a hand-edited data.json can supply it. */
function stored(apiKey: unknown, apiUrl: unknown): ApiKeySettings {
  return { apiKey, apiUrl } as unknown as ApiKeySettings;
}

describe("normalizeApiKey", () => {
  it("trims the whitespace a paste leaves around the key", () => {
    expect(normalizeApiKey(`  ${KEY}\n`)).toBe(KEY);
    expect(normalizeApiKey("   ")).toBe("");
  });

  it("treats a non-string as no key rather than throwing", () => {
    expect(normalizeApiKey(null)).toBe("");
    expect(normalizeApiKey(undefined)).toBe("");
    expect(normalizeApiKey(123)).toBe("");
  });
});

describe("normalizeApiSettings", () => {
  it("keeps stored strings, whitespace and all", () => {
    expect(
      normalizeApiSettings({ apiKey: ` ${KEY} `, apiUrl: "http://localhost:3000" }),
    ).toEqual({ apiKey: ` ${KEY} `, apiUrl: "http://localhost:3000" });
  });

  it("falls back to the defaults for a hand-edited non-string", () => {
    expect(normalizeApiSettings({ apiKey: null, apiUrl: 123 })).toEqual({
      apiKey: "",
      apiUrl: DEFAULT_API_URL,
    });
    expect(normalizeApiSettings({ apiKey: undefined, apiUrl: undefined })).toEqual({
      apiKey: "",
      apiUrl: DEFAULT_API_URL,
    });
  });
});

describe("isDefaultApiUrl", () => {
  it("treats empty, the hosted URL and trailing slashes as no override", () => {
    expect(isDefaultApiUrl("")).toBe(true);
    expect(isDefaultApiUrl(DEFAULT_API_URL)).toBe(true);
    expect(isDefaultApiUrl("https://makespdf.com/")).toBe(true);
    expect(isDefaultApiUrl("  https://makespdf.com// ")).toBe(true);
  });

  it("treats any other URL as an override", () => {
    expect(isDefaultApiUrl("http://localhost:3000")).toBe(false);
    expect(isDefaultApiUrl("https://pdf.example.com")).toBe(false);
  });

  it("treats a non-string as no override rather than throwing", () => {
    expect(isDefaultApiUrl(null)).toBe(true);
    expect(isDefaultApiUrl(undefined)).toBe(true);
    expect(isDefaultApiUrl(123)).toBe(true);
  });
});

describe("apiKeyFormatWarning", () => {
  it("stays quiet with no key, or with a key in the hosted format", () => {
    expect(apiKeyFormatWarning({ apiKey: "", apiUrl: DEFAULT_API_URL })).toBeUndefined();
    expect(apiKeyFormatWarning({ apiKey: "   ", apiUrl: DEFAULT_API_URL })).toBeUndefined();
    expect(apiKeyFormatWarning({ apiKey: KEY, apiUrl: DEFAULT_API_URL })).toBeUndefined();
  });

  it("accepts a valid key that was pasted with whitespace around it", () => {
    expect(apiKeyFormatWarning({ apiKey: ` ${KEY} `, apiUrl: "" })).toBeUndefined();
  });

  it("warns for a key the hosted service would reject", () => {
    for (const apiKey of [
      "junk",
      "sk-live-123",
      "MPDF_" + "a1B2".repeat(8), // the prefix is lower-case
      `mpdf_${"a1B2".repeat(8)}X`, // one character too many
      `mpdf_${"a1B2".repeat(7)}`, // one too few
      `mpdf_${"a1B2".repeat(7)}a1B-`, // 32 characters, one non-alphanumeric
    ]) {
      expect(apiKeyFormatWarning({ apiKey, apiUrl: DEFAULT_API_URL })).toBe(
        API_KEY_FORMAT_WARNING,
      );
    }
  });

  it("does not warn when an API URL override is set", () => {
    expect(apiKeyFormatWarning({ apiKey: "junk", apiUrl: "http://localhost:3000" })).toBeUndefined();
  });

  it("tolerates a hand-edited data.json's non-string values", () => {
    for (const apiKey of [null, undefined, 123, true, {}]) {
      expect(() => apiKeyFormatWarning(stored(apiKey, DEFAULT_API_URL))).not.toThrow();
      expect(apiKeyFormatWarning(stored(apiKey, DEFAULT_API_URL))).toBeUndefined();
    }
    // A non-string URL is no usable override, so it reads as the default: a
    // key that looks wrong still warns rather than being silently excused.
    expect(apiKeyFormatWarning(stored("junk", null))).toBe(API_KEY_FORMAT_WARNING);
    expect(apiKeyFormatWarning(stored(KEY, 123))).toBeUndefined();
  });

  it("still warns when the default URL is spelled with a trailing slash", () => {
    expect(apiKeyFormatWarning({ apiKey: "junk", apiUrl: "https://makespdf.com/" })).toBe(
      API_KEY_FORMAT_WARNING,
    );
    expect(apiKeyFormatWarning({ apiKey: "junk", apiUrl: "" })).toBe(API_KEY_FORMAT_WARNING);
  });

  it("matches the server's key pattern exactly", () => {
    // The hint is only honest if the pattern is the one the server mints.
    expect(API_KEY_SHAPE.source).toBe("^mpdf_[A-Za-z0-9]{32}$");
    expect(API_KEY_SHAPE.test(KEY)).toBe(true);
    expect(API_KEY_FORMAT_WARNING).toContain("mpdf_");
  });
});
