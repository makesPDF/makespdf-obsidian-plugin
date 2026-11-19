/**
 * Reading Obsidian's enabled-plugin list.
 *
 * `App.plugins` is not in the public typings, so it is described structurally
 * and feature-detected, as `plugin-settings.ts` does for `App.setting`: a
 * build without the internal API leaves the adapter off rather than throwing
 * during an export.
 *
 * The list is a `Set<string>` at runtime. It is described by its `has`
 * method so a test can supply a fake without the DOM or the obsidian module.
 */

/** The internal `App.plugins` surface this plugin relies on. */
export interface PluginRegistryApp {
  plugins?: {
    enabledPlugins?: { has?: (pluginId: string) => boolean };
  };
}

/** True when Obsidian reports the community plugin `pluginId` as enabled. */
export function isEnabledPlugin(app: PluginRegistryApp, pluginId: string): boolean {
  return app.plugins?.enabledPlugins?.has?.(pluginId) === true;
}
