import type { AgUiChatProvider } from './provider/ag-ui-chat-provider'

/** One provider per conversation key (use-x-chat skill: "each conversation must have its own Provider instance"). */
const providers = new Map<string, AgUiChatProvider>()

export const getProvider = (key: string, create: () => AgUiChatProvider): AgUiChatProvider => {
	let provider = providers.get(key)
	if (!provider) {
		provider = create()
		providers.set(key, provider)
	}
	return provider
}

export const clearProviders = () => providers.clear()
