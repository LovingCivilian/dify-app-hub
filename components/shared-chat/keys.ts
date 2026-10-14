import { generateUuidV4 } from '@/lib/helpers'

/**
 * The shared chat's useXChat keys (Part 2 spec §5.2; ADR-0017). The x-sdk keeps one message store per key in a
 * module-global map, so a key carries the app id; a new chat gets a temporary key that never changes during the page
 * session, and the conversation id the server answers (`hub:run`) is kept on the conversation item instead. The Dify
 * chat's keys (components/chat/provider/keys.ts) name that id `difyId` and go with the Dify chat in Part 3 (plan call
 * P11).
 */
const TEMP = 'temp'

export const conversationKeyFor = (appId: string, conversationId: string) =>
	`${appId}:${conversationId}`

export const newTempConversationKey = (appId: string) => `${appId}:${TEMP}:${generateUuidV4()}`

export const parseConversationKey = (
	key: string,
): { appId: string; conversationId?: string; temp: boolean } => {
	const [appId = '', second] = key.split(':')
	if (second === TEMP) return { appId, temp: true }
	return { appId, conversationId: second || undefined, temp: false }
}
