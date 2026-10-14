'use client'

import { createContext, useContext } from 'react'

import type { ChatAppDto } from '@/lib/data/apps'
import type { DifyApi } from '@/lib/providers/dify/browser'
import type { AppParameters, SiteSettings } from '@/lib/providers/dify/types'

/** A Dify app's chat DTO: what ProviderChat hands this workspace (Part 1 spec §5). */
export type DifyChatApp = Extract<ChatAppDto, { provider: 'dify' }>

/** The open app and what was loaded for it: one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: DifyChatApp
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
