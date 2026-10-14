import AppUnavailable from '@/components/chat/app-unavailable'
import ProviderChat from '@/components/provider-ui/provider-chat'
import { requireUser } from '@/lib/auth/session'
import { getChatApp } from '@/lib/data/apps'
import { isId } from '@/lib/ids'

/**
 * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to its provider's chat view as a DTO
 * without the API base or the key. A missing or disabled app renders its state instead of the workspace; an id that
 * is not a UUID is a missing app and reaches no query (spec §3.2; lib/ids.ts).
 */
export default async function AppChatPage({ params }: PageProps<'/chat/[appId]'>) {
	const actor = await requireUser()
	const { appId } = await params
	const app = isId(appId) ? await getChatApp(actor, appId) : null
	if (!app) return <AppUnavailable reason="missing" />
	if (!app.enabled) return <AppUnavailable reason="disabled" />
	// Keyed by the app: another app starts from a fresh view (React: resetting state with a key). ProviderChat picks the
	// provider's chat view on the client (Part 1 spec §3).
	return (
		<ProviderChat
			key={appId}
			app={app}
		/>
	)
}
