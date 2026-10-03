'use client'

import type { Locale } from 'antd/es/locale'
import arEG from 'antd/locale/ar_EG'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/ar-sa'
import 'dayjs/locale/zh-cn'

const FALLBACK = 'en'

// Ant Design ships a single Arabic pack (ar_EG); its strings are standard Arabic.
const antdLocales: Record<string, Locale> = {
	en: enUS,
	zh: zhCN,
	ar: arEG,
}

// Ant Design's date components also need the matching Day.js locale, otherwise
// month and weekday names stay in English. Saudi Arabic keeps Western digits.
const dayjsLocales: Record<string, string> = {
	en: 'en',
	zh: 'zh-cn',
	ar: 'ar-sa',
}

/**
 * Ant Design locale pack for an i18next language, falling back to English.
 */
export const getAntdLocale = (language?: string): Locale =>
	antdLocales[language ?? FALLBACK] ?? antdLocales[FALLBACK]

/**
 * Switch Day.js to the locale matching an i18next language, falling back to English.
 */
export const applyDayjsLocale = (language?: string) => {
	dayjs.locale(dayjsLocales[language ?? FALLBACK] ?? dayjsLocales[FALLBACK])
}
