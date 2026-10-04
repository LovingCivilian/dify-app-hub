import React, { useCallback, useEffect, useState } from 'react'

import { genLocalStorageKey, LocalStorageKeys, LocalStorageStore } from '@/lib/helpers'

import { ThemeEnum, ThemeModeEnum } from './constants'
import {
	DEFAULT_INITIAL_THEME,
	InitialTheme,
	THEME_MODE_COOKIE,
	themeCookieStrings,
} from './theme-cookie'

export type IThemeMode = 'light' | 'dark' | 'system'
export type ICurrentTheme = 'light' | 'dark'

export interface IThemeContext {
	theme: ThemeEnum
	themeMode: ThemeModeEnum
	setThemeMode: (theme: ThemeModeEnum) => void
}

export const ThemeContext = React.createContext<IThemeContext>({
	theme: ThemeEnum.LIGHT,
	setThemeMode: () => {},
	themeMode: ThemeModeEnum.SYSTEM,
})

/** Class the dark scheme puts on <body>; app/layout.tsx renders it on the server from the cookie. */
export const DARK_CLASS_NAME = 'dark'

/** Deletes the pre-ADR-0016 localStorage entries; localStorage can throw (privacy modes, sandboxed frames). */
const removeLegacyThemeEntries = () => {
	try {
		localStorage.removeItem(genLocalStorageKey(LocalStorageKeys.THEME_MODE))
		localStorage.removeItem(genLocalStorageKey(LocalStorageKeys.THEME))
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}

/**
 * Theme mode (system / light / dark) and the resolved scheme. The initial value comes from the
 * server (cookies read in app/layout.tsx), so the first render matches the first HTML on both sides;
 * every change is written back to the two cookies (ADR-0016). System mode follows
 * prefers-color-scheme live.
 */
export const ThemeContextProvider = ({
	initialTheme = DEFAULT_INITIAL_THEME,
	children,
}: {
	initialTheme?: InitialTheme
	children: React.ReactNode
}) => {
	const [themeMode, setThemeMode] = useState<ThemeModeEnum>(initialTheme.mode)
	const [themeState, setThemeState] = useState<ThemeEnum>(initialTheme.resolved)

	// One-time migration from the localStorage entries the fork used before ADR-0016: read, remove (so an expired
	// cookie can never revive an old value), and apply only when no cookie exists yet (the cookie wins).
	// Declared before the cookie-write effect below on purpose: that effect creates the cookie this one reads.
	useEffect(() => {
		const legacy = LocalStorageStore.get(LocalStorageKeys.THEME_MODE) as ThemeModeEnum | null
		removeLegacyThemeEntries()
		if (document.cookie.includes(`${THEME_MODE_COOKIE}=`)) return
		if (legacy && Object.values(ThemeModeEnum).includes(legacy)) setThemeMode(legacy)
	}, [])

	const applyScheme = useCallback((dark: boolean) => {
		setThemeState(dark ? ThemeEnum.DARK : ThemeEnum.LIGHT)
		document.body.classList.toggle(DARK_CLASS_NAME, dark)
	}, [])

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
		if (themeMode !== ThemeModeEnum.SYSTEM) {
			applyScheme(themeMode === ThemeModeEnum.DARK)
			return
		}
		const onChange = (event: MediaQueryList | MediaQueryListEvent) => applyScheme(event.matches)
		onChange(mediaQuery)
		mediaQuery.addEventListener('change', onChange)
		return () => mediaQuery.removeEventListener('change', onChange)
	}, [themeMode, applyScheme])

	useEffect(() => {
		const secure = window.location.protocol === 'https:'
		for (const cookie of themeCookieStrings(themeMode, themeState, secure)) {
			document.cookie = cookie
		}
	}, [themeMode, themeState])

	return (
		<ThemeContext.Provider value={{ theme: themeState, themeMode, setThemeMode }}>
			{children}
		</ThemeContext.Provider>
	)
}

export const useThemeContext = () => {
	const context = React.useContext(ThemeContext)
	return {
		...context,
		isDark: context.theme === ThemeEnum.DARK,
		isLight: context.theme === ThemeEnum.LIGHT,
		isSystemMode: context.themeMode === ThemeModeEnum.SYSTEM,
	}
}
