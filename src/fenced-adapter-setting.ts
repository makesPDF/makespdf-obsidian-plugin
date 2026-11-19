/**
 * The settings row for one bundled fenced-block adapter: a name, a
 * description and a toggle bound to the adapter's entry in the settings map.
 *
 * Drawn by both settings renderers (the 1.13+ declarative definitions and the
 * legacy `display()`), so they cannot drift. Kept free of the `obsidian`
 * import — the row is described structurally like `api-key-setting.ts` — so its
 * wiring is unit-testable (see fenced-adapter-setting.test.ts).
 */

import type { FencedAdapter, FencedAdapterSettings } from "./fenced-adapters";
import { isAdapterEnabled } from "./fenced-adapters";

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

/**
 * Draw the row and bind its toggle. The settings map is written in place and
 * then persisted, matching how the other settings rows save.
 */
export function drawFencedAdapterSetting(
  setting: AdapterSettingRow,
  adapter: FencedAdapter,
  settings: FencedAdapterSettings,
  saveSettings: () => Promise<void>,
): void {
  setting.setName(adapter.name);
  setting.setDesc(adapter.description);
  setting.addToggle((toggle) =>
    toggle.setValue(isAdapterEnabled(settings, adapter.id)).onChange(async (value) => {
      settings[adapter.id] = value;
      await saveSettings();
    }),
  );
}
