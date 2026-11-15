/**
 * The API key settings row: the field plus the inline format warning.
 *
 * Kept free of the `obsidian` import so the row's wiring — the warning
 * element, its refresh from both fields, and the API URL override that turns
 * it off — is unit-testable, the same way `api-key.ts` keeps the rule itself
 * testable. `main.ts` only supplies the `Setting` and the live settings object;
 * both the 1.13+ declarative definition and the pre-1.13 `display()` fallback
 * call it, so neither renderer can draw a different row.
 */
import { apiKeyFormatWarning } from "./api-key";

/** The setting copy, shared by the row and the declarative definition. */
export const API_KEY_DESC =
  "Optional. Without a key, exports use the free anonymous path (rate-limited, up to 20 pages per render). Add a key from your makespdf.com account for higher limits and larger documents.";

/** The warning line under the field. */
export interface ApiKeyWarningElement {
  setText(text: string): void;
  toggle(show: boolean): void;
}

/** The parts of obsidian's `Setting` this row uses. */
export interface ApiKeySettingRow {
  setName(name: string): unknown;
  setDesc(desc: string): unknown;
  setClass(cls: string): unknown;
  settingEl: {
    createDiv(options: {
      cls: string;
      attr: Record<string, string>;
    }): ApiKeyWarningElement;
  };
  addText(callback: (text: ApiKeyTextControl) => unknown): unknown;
}

/** The parts of obsidian's `TextComponent` this row uses. */
export interface ApiKeyTextControl {
  setPlaceholder(placeholder: string): ApiKeyTextControl;
  setValue(value: string): ApiKeyTextControl;
  onChange(callback: (value: string) => unknown): ApiKeyTextControl;
}

/** The settings fields the row reads and writes, live from the plugin. */
export interface ApiKeyRowSettings {
  apiKey: string;
  apiUrl: string;
}

/**
 * Draw the row into `setting` and return the warning refresh. The API URL
 * control calls that refresh too, because an override turns the warning off
 * and the URL can change while the tab is open.
 *
 * A warning only: the key is saved and sent as typed, so the declarative
 * `validate` hook — which rejects the value it complains about — cannot be
 * used for it.
 */
export function drawApiKeySetting(
  setting: ApiKeySettingRow,
  settings: ApiKeyRowSettings,
  saveSettings: () => Promise<void>,
): () => void {
  setting.setName("API key");
  setting.setDesc(API_KEY_DESC);
  setting.setClass("makespdf-api-key-setting");

  // Appended to the row rather than the description element: the warning has
  // to sit outside whatever the declarative renderer does with name/desc.
  const warningEl = setting.settingEl.createDiv({
    cls: "makespdf-api-key-warning",
    attr: { role: "status" },
  });

  const refreshWarning = () => {
    const warning = apiKeyFormatWarning({
      apiKey: settings.apiKey,
      apiUrl: settings.apiUrl,
    });
    warningEl.setText(warning ?? "");
    warningEl.toggle(warning !== undefined);
  };

  setting.addText((text) =>
    text
      .setPlaceholder("Paste your API key")
      .setValue(settings.apiKey)
      .onChange(async (value) => {
        settings.apiKey = value;
        refreshWarning();
        await saveSettings();
      }),
  );

  refreshWarning();
  return refreshWarning;
}
