/**
 * Opening this plugin's tab in Obsidian's settings modal.
 *
 * `App.setting` is not in the public typings, so it is described structurally
 * and feature-detected: a build without the internal API leaves the link a
 * no-op rather than throwing. Kept free of the `obsidian` import so the call
 * order is unit-testable; `main.ts` only supplies the app and its id.
 */

/** The internal settings-modal surface this plugin relies on. */
export interface SettingsModalApp {
  setting?: {
    /** Shows the settings modal (inherited from `Modal`). */
    open?: () => void;
    /** Selects a tab *inside* an open modal; it never opens the modal itself. */
    openTabById?: (pluginId: string) => void;
  };
}

/**
 * Show the settings modal, then select this plugin's tab. Both calls are
 * required and in this order: `openTabById` only switches a tab in an
 * already-open modal, so on its own it renders the tab into a still-hidden
 * modal and the user sees nothing.
 */
export function openPluginSettingsTab(app: SettingsModalApp, pluginId: string): void {
  const settings = app.setting;
  settings?.open?.();
  settings?.openTabById?.(pluginId);
}
