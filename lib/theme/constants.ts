/**
 * Theme enum
 */
export enum ThemeEnum {
	LIGHT = 'light',
	DARK = 'dark',
}

/**
 * Theme mode enum
 */
export enum ThemeModeEnum {
	SYSTEM = 'system',
	LIGHT = 'light',
	DARK = 'dark',
}

/**
 * Theme mode label keys
 */
export const ThemeModeLabelEnum = {
	SYSTEM: 'system.theme_mode_system',
	LIGHT: 'system.theme_mode_light',
	DARK: 'system.theme_mode_dark',
} as const

/**
 * The options for the theme mode constants
 */
export const ThemeModeOptions = [
	{
		label: ThemeModeLabelEnum.SYSTEM,
		value: ThemeModeEnum.SYSTEM,
	},
	{
		label: ThemeModeLabelEnum.LIGHT,
		value: ThemeModeEnum.LIGHT,
	},
	{
		label: ThemeModeLabelEnum.DARK,
		value: ThemeModeEnum.DARK,
	},
]
