'use client'

import { Actions } from '@ant-design/x'
import { memo } from 'react'

import { turnText, type Turn } from '@/lib/chat/turn'

/**
 * An answer's footer (spec §5.3: copy in X Actions): `Actions.Copy`, antd's Typography copy button named by antd's
 * locale ("Copy"), as the Dify chat's footer renders it. Not while the turn streams, and not for an answer with no text.
 */
function TurnFooter({ turn, status }: { turn: Turn; status?: string }) {
	const text = turnText(turn)
	if (!text || status === 'updating' || status === 'loading') return null
	return (
		<Actions
			items={[{ key: 'copy', actionRender: () => <Actions.Copy text={text} /> }]}
			variant="borderless"
		/>
	)
}

export default memo(TurnFooter)
