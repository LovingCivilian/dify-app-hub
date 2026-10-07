import AppUnavailable from '@/components/chat/app-unavailable'
import ChatWorkspace from '@/components/chat/chat-workspace'
import { requireUser } from '@/lib/auth/session'
import { getChatApp } from '@/lib/data/apps'

/**
 * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to the workspace as a DTO
 * without the API base or the key. A missing or disabled app renders its state instead of the workspace.
 */
export default async function AppChatPage({ params }: PageProps<'/chat/[appId]'>) {
	const actor = await requireUser()
	const { appId } = await params
	const app = await getChatApp(actor, appId)
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
