'use client'

import { Typography } from 'antd'

import styles from '@/components/chat/chat-view/user-content.module.css'
import { turnText, type Turn } from '@/lib/chat/turn'

/** A user bubble (spec §5.3): the text as typed, line breaks kept (the Dify chat's user text style). 2c adds files. */
export default function UserTurn({ turn }: { turn: Turn }) {
	return <Typography.Text className={styles.text}>{turnText(turn)}</Typography.Text>
}
