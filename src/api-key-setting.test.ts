/**
 * Tests for the API key settings row's wiring: the warning element, its
 * refresh from the key field, and the API URL override that turns it off.
 *
 * The row is an obsidian-free function driven here by a fake `Setting`, so the
 * real DOM and the obsidian module stay out of the suite; `main.ts` supplies
 * both from its two renderers.
 */
import { describe, it, expect, vi } from "vitest";

import { API_KEY_FORMAT_WARNING, DEFAULT_API_URL } from "./api-key";
import {
  API_KEY_DESC,
  drawApiKeySetting,
  type ApiKeyRowSettings,
  type ApiKeySettingRow,
  type ApiKeyTextControl,
  type ApiKeyWarningElement,
} from "./api-key-setting";

/** A well-formed key: `mpdf_` plus 32 alphanumerics. */
const KEY = `mpdf_${"a1B2".repeat(8)}`;

/** What `setting.settingEl.createDiv` returns in the fake below. */
class FakeWarningElement implements ApiKeyWarningElement {
  text = "";
  visible = true;
  cls = "";
  attr: Record<string, string> = {};

  setText(text: string): void {
    this.text = text;
  }

  toggle(show: boolean): void {
    this.visible = show;
  }
}

/** The text component `setting.addText` passes to the row. */
class FakeTextControl implements ApiKeyTextControl {
  value = "";
  placeholder = "";
  private change: ((value: string) => unknown) | undefined;

  setPlaceholder(placeholder: string): this {
    this.placeholder = placeholder;
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.change = callback;
    return this;
  }

  /** Stand in for the user typing into the field. */
  async type(value: string): Promise<void> {
    this.value = value;
    await Promise.resolve(this.change?.(value));
  }
}

/** The fake `Setting` the row draws into, recording what it created. */
class FakeSettingRow implements ApiKeySettingRow {
  name = "";
  desc = "";
  cls = "";
  warnings: FakeWarningElement[] = [];
  texts: FakeTextControl[] = [];
  settingEl = {
    createDiv: (options: { cls: string; attr: Record<string, string> }) => {
      const element = new FakeWarningElement();
      element.cls = options.cls;
      element.attr = options.attr;
      this.warnings.push(element);
      return element;
    },
  };

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setClass(cls: string): this {
    this.cls = cls;
    return this;
  }

  addText(callback: (text: ApiKeyTextControl) => unknown): this {
    const text = new FakeTextControl();
    this.texts.push(text);
    callback(text);
    return this;
  }
}

function setup(apiKey: string, apiUrl: string) {
  const settings: ApiKeyRowSettings = { apiKey, apiUrl };
  const saveSettings = vi.fn(() => Promise.resolve());
  const row = new FakeSettingRow();
  const refresh = drawApiKeySetting(row, settings, saveSettings);
  const warning = row.warnings[0];
  return { settings, saveSettings, row, refresh, warning };
}

describe("drawApiKeySetting", () => {
  it("draws the named field and appends a warning element", () => {
    const { row, warning } = setup("junk", DEFAULT_API_URL);

    expect(row.name).toBe("API key");
    expect(row.desc).toBe(API_KEY_DESC);
    expect(row.cls).toBe("makespdf-api-key-setting");
    expect(row.texts).toHaveLength(1);
    expect(row.texts[0].placeholder).toBe("Paste your API key");
    expect(row.texts[0].value).toBe("junk");
    expect(row.warnings).toHaveLength(1);
    expect(warning.cls).toBe("makespdf-api-key-warning");
    expect(warning.attr).toEqual({ role: "status" });
  });

  it("shows the warning for a malformed key with the default URL", () => {
    const { warning } = setup("junk", DEFAULT_API_URL);

    expect(warning.visible).toBe(true);
    expect(warning.text).toBe(API_KEY_FORMAT_WARNING);
  });

  it("hides the warning once the key is fixed, saving each keystroke", async () => {
    const { row, warning, settings, saveSettings } = setup("junk", DEFAULT_API_URL);

    await row.texts[0].type(KEY);

    expect(settings.apiKey).toBe(KEY);
    expect(warning.visible).toBe(false);
    expect(warning.text).toBe("");
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("shows no warning when an API URL override is set", () => {
    const { warning } = setup("junk", "http://localhost:3000");

    expect(warning.visible).toBe(false);
    expect(warning.text).toBe("");
  });

  it("refreshes when the API URL changes in either direction", () => {
    const { settings, refresh, warning } = setup("junk", DEFAULT_API_URL);
    expect(warning.visible).toBe(true);

    settings.apiUrl = "https://pdf.example.com";
    refresh();
    expect(warning.visible).toBe(false);

    settings.apiUrl = "";
    refresh();
    expect(warning.visible).toBe(true);
    expect(warning.text).toBe(API_KEY_FORMAT_WARNING);
  });

  it("still saves a key that looks wrong: the warning never blocks", async () => {
    const { row, warning, settings, saveSettings } = setup("", DEFAULT_API_URL);
    expect(warning.visible).toBe(false);

    await row.texts[0].type("sk-live-123");

    expect(settings.apiKey).toBe("sk-live-123");
    expect(warning.visible).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});
