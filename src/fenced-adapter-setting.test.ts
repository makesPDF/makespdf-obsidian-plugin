/**
 * Tests for the adapter settings row: it draws the adapter's name and
 * description, starts from the saved value, and writes the new value through.
 *
 * The real `Setting`/`ToggleComponent` stay out of the suite; the row is an
 * obsidian-free function driven here by a fake.
 */
import { describe, it, expect, vi } from "vitest";

import { drawFencedAdapterSetting, type AdapterToggleControl } from "./fenced-adapter-setting";
import type { FencedAdapter, FencedAdapterSettings } from "./fenced-adapters";

const ADAPTER: FencedAdapter = {
  id: "vtable",
  fence: "vtable",
  name: "Vtable tables",
  description: "Convert vtable blocks.",
  aliases: ["vtable"],
  toMarkdown: () => null,
};

class FakeToggle implements AdapterToggleControl {
  value = false;
  private change: ((value: boolean) => unknown) | undefined;

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.change = callback;
    return this;
  }

  async click(value: boolean): Promise<void> {
    this.value = value;
    await Promise.resolve(this.change?.(value));
  }
}

class FakeRow {
  name = "";
  desc = "";
  toggles: FakeToggle[] = [];

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  addToggle(callback: (toggle: AdapterToggleControl) => unknown): this {
    const toggle = new FakeToggle();
    this.toggles.push(toggle);
    callback(toggle);
    return this;
  }
}

function setup(settings: FencedAdapterSettings) {
  const row = new FakeRow();
  const save = vi.fn(() => Promise.resolve());
  drawFencedAdapterSetting(row, ADAPTER, settings, save);
  return { row, save, toggle: row.toggles[0] };
}

describe("drawFencedAdapterSetting", () => {
  it("draws the adapter's name and description with a toggle", () => {
    const { row, toggle } = setup({ vtable: true });
    expect(row.name).toBe("Vtable tables");
    expect(row.desc).toBe("Convert vtable blocks.");
    expect(row.toggles).toHaveLength(1);
    expect(toggle).toBeDefined();
  });

  it("starts from the saved setting", () => {
    expect(setup({ vtable: true }).toggle.value).toBe(true);
    expect(setup({ vtable: false }).toggle.value).toBe(false);
    expect(setup({}).toggle.value).toBe(true); // missing means on
  });

  it("writes the new value and saves", async () => {
    const settings: FencedAdapterSettings = { vtable: true };
    const { toggle, save } = setup(settings);
    await toggle.click(false);
    expect(settings.vtable).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
