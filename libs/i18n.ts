import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import { LANGUAGE_COOKIE, languageCookieOptions } from '@/lib/i18n/language-cookie'
import ar from '@/locales/ar/translation.json'
import en from '@/locales/en/translation.json'
import zh from '@/locales/zh/translation.json'

await i18n
	// detect user language
	// learn more: https://github.com/i18next/i18next-browser-languageDetector
	.use(LanguageDetector)
	// pass the i18n instance to react-i18next.
	.use(initReactI18next)
	// init i18next
	// for all options read: https://www.i18next.com/overview/configuration-options
	.init({
		debug: false,
		fallbackLng: 'en',
		// Detector options (i18next-browser-languagedetector README, "Detector Options"). The cookie comes first and
		// is the one source the server can read too (app/layout.tsx renders its language, ADR-0005 note 2026-10-05).
		// No `querystring`: the root layout cannot see `?lng=`, so a query override would render one language on the
		// server and another in the browser. The detector caches the language (cacheUserLanguage, "called after init
		// and on changeLanguage") in the cookie and in localStorage, so a value older visits left in localStorage is
		// still found when no cookie exists yet.
		detection: {
			order: ['cookie', 'localStorage', 'navigator'],
			caches: ['cookie', 'localStorage'],
			lookupCookie: LANGUAGE_COOKIE,
			cookieMinutes: 525600, // one year, like the theme cookies (ADR-0016)
			// Secure on https, like the theme cookies; the module also runs on the server, where there is no window.
			cookieOptions: languageCookieOptions(
				typeof window !== 'undefined' && window.location.protocol === 'https:',
			),
		},
		interpolation: {
			escapeValue: false, // not needed for react as it escapes by default
		},
		resources: {
			en: { translation: en },
			zh: { translation: zh },
			ar: { translation: ar },
		},
	})

export default i18n
