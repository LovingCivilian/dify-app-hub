'use client'

import { createContext, useContext } from 'react'

import type { ChatAppDto } from '@/lib/data/apps'
import type { DifyApi } from '@/lib/dify/browser'
import type { AppParameters, SiteSettings } from '@/lib/dify/types'

/** The open app and what was loaded for it: one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: ChatAppDto
	parameters: AppParameters
	site: SiteSettings
	difyApi: DifyApi
}

export const AppContext = createContext<AppContextValue | null>(null)

export const useAppContext = (): AppContextValue => {
	const value = useContext(AppContext)
	if (!value) throw new Error('useAppContext must be used inside ChatWorkspace')
	return value
}
