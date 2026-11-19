/**
 * The settings row for one bundled adapter: a name, a description and a
 * toggle bound to the adapter's entry in the settings map.
 *
 * Both adapter kinds (a fenced-block adapter and a whole-document one) draw
 * the same row, and both settings renderers (the 1.13+ declarative
 * definitions and the legacy `display()`) call this function, so they cannot
 * drift. Kept free of the `obsidian` import — the row is described
 * structurally like `api-key-setting.ts` — so its wiring is unit-testable
 * (see adapter-setting.test.ts).
 */

import { isAdapterEnabled } from "./fenced-adapters";

/** The parts of an adapter the row shows; both adapter kinds fit. */
export interface AdapterSettingAdapter {
  /** Stable settings key. */
  id: string;
  /** Settings row title. */
  name: string;
  /** Settings row description. */
  description: string;
}

/** The parts of obsidian's `ToggleComponent` this row uses. */
export interface AdapterToggleControl {
  setValue(value: boolean): AdapterToggleControl;
  onChange(callback: (value: boolean) => unknown): AdapterToggleControl;
}

/** The parts of obsidian's `Setting` this row uses. */
export interface AdapterSettingRow {
  setName(name: string): unknown;
  setDesc(desc: string): unknown;
  addToggle(callback: (toggle: AdapterToggleControl) => unknown): unknown;
}

/** The switches either adapter kind stores, keyed by adapter id. */
export type AdapterSettings = Record<string, boolean>;

/**
 * Draw the row and bind its toggle. The settings map is written in place and
 * then persisted, matching how the other settings rows save.
 *
 * `enabledByDefault` is the adapter kind's own default: a fenced adapter
 * starts on, a whole-document one starts off, and a stored boolean always
 * wins over both.
 */
export function drawAdapterSetting(
  setting: AdapterSettingRow,
  adapter: AdapterSettingAdapter,
  settings: AdapterSettings,
  saveSettings: () => Promise<void>,
  enabledByDefault = true,
): void {
  setting.setName(adapter.name);
  setting.setDesc(adapter.description);
  setting.addToggle((toggle) =>
    toggle
      .setValue(isAdapterEnabled(settings, adapter.id, enabledByDefault))
      .onChange(async (value) => {
        settings[adapter.id] = value;
        await saveSettings();
      }),
  );
}
