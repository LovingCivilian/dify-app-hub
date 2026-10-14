'use client'

import { Welcome } from '@ant-design/x'

import { useChatAppInfo } from '@/components/chat/chat-view/app-info-context'
import styles from '@/components/chat/chat-view/chat-view.module.css'
import { AppAvatar } from '@/components/chat/chat-view/conversation-sidebar'

/**
 * X Welcome on an empty conversation (spec §5.3): the app's icon, name and description. AG-UI has no opening statement
 * or suggested questions, so there is nothing else to show.
 */
export default function SharedWelcome({ visible }: { visible: boolean }) {
	const app = useChatAppInfo()
	if (!visible) return null
	return (
		<div className={styles.welcome}>
			<Welcome
				variant="borderless"
				icon={
					<AppAvatar
						size="large"
						alt={app.name}
					/>
				}
				title={app.name}
				description={app.description || undefined}
			/>
		</div>
	)
}
