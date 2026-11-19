/**
 * Tests for the adapter settings row: it draws the adapter's name and
 * description, starts from the saved value, and writes the new value through.
 *
 * Both adapter kinds draw through the same row, and the two differ in their
 * default: a fenced adapter starts on, a whole-document one starts off.
 *
 * The real `Setting`/`ToggleComponent` stay out of the suite; the row is an
 * obsidian-free function driven here by a fake.
 */
import { describe, it, expect, vi } from "vitest";

import { drawAdapterSetting, type AdapterSettingAdapter, type AdapterToggleControl } from "./adapter-setting";

const ADAPTER: AdapterSettingAdapter = {
  id: "vtable",
  name: "Vtable tables",
  description: "Convert vtable blocks.",
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

function setup(settings: Record<string, boolean>, enabledByDefault = true) {
  const row = new FakeRow();
  const save = vi.fn(() => Promise.resolve());
  drawAdapterSetting(row, ADAPTER, settings, save, enabledByDefault);
  return { row, save, toggle: row.toggles[0] };
}

describe("drawAdapterSetting", () => {
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
    expect(setup({}).toggle.value).toBe(true); // a fenced adapter's default is on
  });

  it("starts a whole-document adapter off by default", () => {
    expect(setup({}, false).toggle.value).toBe(false);
    expect(setup({ vtable: true }, false).toggle.value).toBe(true);
  });

  it("writes the new value and saves", async () => {
    const settings: Record<string, boolean> = { vtable: true };
    const { toggle, save } = setup(settings);
    await toggle.click(false);
    expect(settings.vtable).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
