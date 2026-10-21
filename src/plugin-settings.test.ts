/**
 * Tests for the "Open settings" link's call into Obsidian's internal
 * settings-modal API: the modal must be opened before its tab is selected,
 * and a build without that API must leave the link a no-op.
 */
import { describe, it, expect, vi } from "vitest";

import { openPluginSettingsTab } from "./plugin-settings";

describe("openPluginSettingsTab", () => {
  it("opens the modal before selecting the plugin tab", () => {
    const calls: string[] = [];
    openPluginSettingsTab(
      {
        setting: {
          open: () => calls.push("open"),
          openTabById: (id) => calls.push(`openTabById:${id}`),
        },
      },
      "makespdf",
    );

    // Selecting a tab without opening the modal renders it into a hidden
    // modal, so the order is the fix, not an implementation detail.
    expect(calls).toEqual(["open", "openTabById:makespdf"]);
  });

  it("does not throw when the internal API is absent", () => {
    expect(() => openPluginSettingsTab({}, "makespdf")).not.toThrow();
  });

  it("opens the modal even when selecting a tab is unavailable", () => {
    const open = vi.fn();
    expect(() => openPluginSettingsTab({ setting: { open } }, "makespdf")).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not throw when only openTabById is available", () => {
    const openTabById = vi.fn();
    expect(() =>
      openPluginSettingsTab({ setting: { openTabById } }, "makespdf"),
    ).not.toThrow();
    expect(openTabById).toHaveBeenCalledWith("makespdf");
  });
});
