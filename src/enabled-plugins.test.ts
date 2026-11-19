/**
 * Tests for the structural `app.plugins` lookup: an enabled community plugin
 * is reported, and a build without the internal API reports nothing rather
 * than throwing.
 */
import { describe, it, expect } from "vitest";

import { isEnabledPlugin, type PluginRegistryApp } from "./enabled-plugins";

/** The runtime shape: a Set with the enabled plugin ids. */
function appWith(ids: string[]): PluginRegistryApp {
  return { plugins: { enabledPlugins: new Set(ids) } };
}

describe("isEnabledPlugin", () => {
  it("reports an enabled plugin", () => {
    expect(isEnabledPlugin(appWith(["structural-tables"]), "structural-tables")).toBe(true);
  });

  it("reports a plugin that is not in the list", () => {
    expect(isEnabledPlugin(appWith(["vtable"]), "structural-tables")).toBe(false);
    expect(isEnabledPlugin(appWith([]), "structural-tables")).toBe(false);
  });

  it("reports nothing when the internal API is absent", () => {
    expect(isEnabledPlugin({}, "structural-tables")).toBe(false);
    expect(isEnabledPlugin({ plugins: {} }, "structural-tables")).toBe(false);
    expect(
      isEnabledPlugin({ plugins: { enabledPlugins: {} } }, "structural-tables"),
    ).toBe(false);
  });
});
