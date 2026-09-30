/**
 * Tests for the shared client header: renders and feedback must identify the
 * plugin identically as `obsidian/<version>`, for an anonymous or keyed call.
 */
import { describe, it, expect } from "vitest";

import { CLIENT_KIND, buildRenderHeaders, clientHeaderValue } from "./client";

describe("clientHeaderValue", () => {
  it("is the plain obsidian kind with the manifest version", () => {
    expect(CLIENT_KIND).toBe("obsidian");
    expect(clientHeaderValue("1.1.0")).toBe("obsidian/1.1.0");
  });
});

describe("buildRenderHeaders", () => {
  it("sends the client header on every render, authenticated or not", () => {
    const anon = buildRenderHeaders({ version: "1.1.0", apiKey: "" });
    expect(anon["Content-Type"]).toBe("application/json");
    expect(anon["X-MakesPDF-Client"]).toBe("obsidian/1.1.0");
    expect(anon.Authorization).toBeUndefined();

    const authed = buildRenderHeaders({ version: "1.1.0", apiKey: "key_123" });
    expect(authed["X-MakesPDF-Client"]).toBe("obsidian/1.1.0");
    expect(authed.Authorization).toBe("Bearer key_123");
  });
});
