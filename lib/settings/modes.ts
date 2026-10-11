/**
 * Where a settings area's values come from (settings spec §2 #2), chosen by its `<AREA>_MODE` variable: `disabled` (off;
 * for branding the built-in look), `env` (environment variables, shown read-only) or `database` (edited on the admin page).
 * Unset is `disabled`. Client-safe: the settings pages read it too.
 */
export const SETTINGS_MODES = ['disabled', 'env', 'database'] as const

export type SettingsMode = (typeof SETTINGS_MODES)[number]
