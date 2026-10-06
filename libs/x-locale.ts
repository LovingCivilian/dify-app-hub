import enUS from '@ant-design/x/locale/en_US'
import zhCN from '@ant-design/x/locale/zh_CN'

import arEG_X from './x-locale-ar'

const FALLBACK = 'en'
const packs: Record<string, typeof enUS> = { en: enUS, zh: zhCN, ar: arEG_X }

/** The Ant Design X strings for an i18next language, merged into the XProvider locale next to antd's (X docs: XProvider). */
export const getXLocale = (language?: string): typeof enUS =>
	packs[language ?? FALLBACK] ?? packs[FALLBACK]
