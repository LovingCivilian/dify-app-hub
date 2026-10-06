'use client'

import { createContext, useContext } from 'react'

import type { IDifyAppParameters, IDifyAppSiteSetting } from '@/lib/core'
import type { DifyApi } from '@/lib/dify-client'
import type { IDifyAppItem } from '@/types'

/** The open app and what was loaded for it (spec §4.9): one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: IDifyAppItem
	parameters: IDifyAppParameters
	site: IDifyAppSiteSetting
	difyApi: DifyApi
	userId: string
}

export const AppContext = createContext<AppContextValue | null>(null)

export const useAppContext = (): AppContextValue => {
	const value = useContext(AppContext)
	if (!value) throw new Error('useAppContext must be used inside ChatWorkspace')
	return value
}
