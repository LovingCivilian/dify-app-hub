'use client'

import { createContext, useContext } from 'react'

/** What the chat shows of its app in the sidebar, the collapsed rail and the welcome: its id, name, description and icon. */
export interface ChatAppInfo {
	id: string
	name: string
	description: string
	/** A stored image exists; it loads through the icon route (charter §4.1, §4.4). */
	hasIcon: boolean
}

/**
 * The open app as the chat names it (Part 2 spec §5.1: the sidebar is shared by the Dify chat and the shared chat).
 * Each chat provides it: the Dify chat from Dify's site settings and the app record, the shared chat from the app
 * record. No meaningful default exists, so the default is `null` (react.dev `createContext`) and the hook throws
 * outside a provider, as useAppContext does.
 */
export const ChatAppInfoContext = createContext<ChatAppInfo | null>(null)

export const useChatAppInfo = (): ChatAppInfo => {
	const value = useContext(ChatAppInfoContext)
	if (!value)
		throw new Error('useChatAppInfo must be used inside a chat that provides ChatAppInfoContext')
	return value
}
