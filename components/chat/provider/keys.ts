import { generateUuidV4 } from '@/lib/helpers'

/**
 * useXChat keys (spec §4.3). The x-sdk keeps one message store per key in a module-global map,
 * so keys carry the app id; a new chat gets a temporary key that never changes during the page
 * session — the Dify id it receives is stored on the conversation item instead.
 */
const TEMP = 'temp'

export const conversationKeyFor = (appId: string, difyId: string) => `${appId}:${difyId}`

export const newTempConversationKey = (appId: string) => `${appId}:${TEMP}:${generateUuidV4()}`

export const parseConversationKey = (
	key: string,
): { appId: string; difyId?: string; temp: boolean } => {
	const [appId, second] = key.split(':')
	if (second === TEMP) return { appId, difyId: undefined, temp: true }
	return { appId, difyId: second, temp: false }
}
