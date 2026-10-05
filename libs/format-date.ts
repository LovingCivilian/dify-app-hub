const FALLBACK = 'en'

// BCP 47 tags for the browser's own date formatting (Intl). Arabic uses the
// Saudi locale with the Gregorian calendar and Arabic-Indic digits pinned, so
// the output does not depend on the browser's ICU defaults.
const intlLocales: Record<string, string> = {
	en: 'en-US',
	zh: 'zh-CN',
	ar: 'ar-SA-u-ca-gregory-nu-arab',
}

/**
 * The `Intl` tag for a UI language (`i18n.resolvedLanguage`), English when it is missing or unknown.
 * Numbers use it too, so Arabic digits come out the same way as in dates.
 */
export const intlLocale = (language?: string) =>
	intlLocales[language ?? FALLBACK] ?? intlLocales[FALLBACK]

/**
 * Date and time in the active language, e.g. "1/15/2026, 9:05:00 AM".
 */
export const formatDateTime = (value: Date | number | string, language?: string) =>
	new Date(value).toLocaleString(intlLocale(language))
