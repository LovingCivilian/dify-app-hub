import AppUnavailable from '@/components/chat/app-unavailable'
import ChatWorkspace from '@/components/chat/chat-workspace'
import { requireUser } from '@/lib/auth/session'
import { getChatApp } from '@/lib/data/apps'
import { isId } from '@/lib/ids'

/**
 * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to the workspace as a DTO
 * without the API base or the key. A missing or disabled app renders its state instead of the workspace; an id that
 * is not a UUID is a missing app and reaches no query (spec §3.2; lib/ids.ts).
 */
export default async function AppChatPage({ params }: PageProps<'/chat/[appId]'>) {
	const actor = await requireUser()
	const { appId } = await params
	const app = isId(appId) ? await getChatApp(actor, appId) : null
	if (!app) return <AppUnavailable reason="missing" />
	if (!app.enabled) return <AppUnavailable reason="disabled" />
	// Keyed by the app: another app starts from a fresh workspace (React: resetting state with a key).
	return (
		<ChatWorkspace
			key={appId}
			app={app}
		/>
	)
}
