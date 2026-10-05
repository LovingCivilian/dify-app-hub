import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { applyDayjsLocale } from '@/libs/antd-locale'

/**
 * Write the active language onto the <html> element. The root layout renders the
 * language cookie's value on the server (app/layout.tsx); this keeps the attribute
 * in step when the language changes in the page (the language dropdown).
 * Direction stays ltr for now; set `dir` from `i18n.dir()` here when RTL lands.
 */
export const applyHtmlLang = (html: { lang: string }, language?: string) => {
	if (!language) return
	html.lang = language
}

/**
 * Keep <html lang> and the Day.js locale in sync with the i18next language.
 */
export const useHtmlLang = () => {
	const { i18n } = useTranslation()
	const language = i18n.resolvedLanguage

	useEffect(() => {
		applyHtmlLang(document.documentElement, language)
		applyDayjsLocale(language)
	}, [language])
}
