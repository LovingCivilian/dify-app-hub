'use client'

import AppUnavailable from '@/components/chat/app-unavailable'
import ChatWorkspace from '@/components/chat/chat-workspace'
import type { ChatAppDto } from '@/lib/data/apps'

/**
 * The chat page's one client switch (Part 1 spec §3; DV 9b): the server page hands over the chat DTO, a serializable
 * prop, and the provider's chat view is chosen here, on the client (React "use client" caveats: a server module may
 * pass a client component only serializable values). The switch is exhaustive: a provider added to ProviderId without a
 * view fails tsc at `satisfies never`.
 */
export default function ProviderChat({ app }: { app: ChatAppDto }) {
	switch (app.provider) {
		case 'dify':
			return <ChatWorkspace app={app} />
		case 'agui':
			// Part 2 plan call P12: the shared chat (Task 16) replaces this inside the branch.
			return <AppUnavailable reason="missing" />
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return app satisfies never
	}
}
