'use client'

import type { ConfigProviderProps } from 'antd'
import arEG from 'antd/locale/ar_EG'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import preParsePostFormat from 'dayjs/plugin/preParsePostFormat'
import 'dayjs/locale/ar'
import 'dayjs/locale/zh-cn'

type AntdLocale = NonNullable<ConfigProviderProps['locale']>

const FALLBACK = 'en'

// Ant Design ships a single Arabic pack (ar_EG); its strings are standard Arabic.
const antdLocales: Record<string, AntdLocale> = {
	en: enUS,
	zh: zhCN,
	ar: arEG,
}

// Ant Design's date components also need the matching Day.js locale, otherwise
// month and weekday names stay in English. The Arabic locale's digit mapping
// (Arabic-Indic numerals) is applied by the preParsePostFormat plugin.
const dayjsLocales: Record<string, string> = {
	en: 'en',
	zh: 'zh-cn',
	ar: 'ar',
}

dayjs.extend(preParsePostFormat)

/**
 * Ant Design locale pack for an i18next language, falling back to English.
 */
export const getAntdLocale = (language?: string): AntdLocale =>
	antdLocales[language ?? FALLBACK] ?? antdLocales[FALLBACK]

/**
 * Switch Day.js to the locale matching an i18next language, falling back to English.
 */
export const applyDayjsLocale = (language?: string) => {
	dayjs.locale(dayjsLocales[language ?? FALLBACK] ?? dayjsLocales[FALLBACK])
}
