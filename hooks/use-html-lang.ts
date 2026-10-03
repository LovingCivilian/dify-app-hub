import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { applyDayjsLocale } from '@/libs/antd-locale'

/**
 * Write the active language onto the <html> element. The root layout renders
 * lang="en" on the server; the browser only learns the real language here.
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
