import ChatWorkspace from '@/components/chat/chat-workspace'

export default async function AppChatPage({ params }: { params: Promise<{ appId: string }> }) {
	const { appId } = await params
	// Keyed by the app: another app starts from a fresh workspace (React: resetting state with a key).
	return (
		<ChatWorkspace
			key={appId}
			appId={appId}
		/>
	)
}
