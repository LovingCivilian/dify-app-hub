'use client'

import { Prompts, Welcome } from '@ant-design/x'
import { Flex } from 'antd'

import { useAppContext } from '../app-context'
import MessageMarkdown from '../message/message-markdown'
import styles from './chat-view.module.css'
import { AppAvatar } from './conversation-sidebar'

export interface WelcomePanelProps {
	visible: boolean
	/** The suggested questions are not offered while a reply streams (a click would be ignored). */
	disabled?: boolean
	onPrompt: (text: string) => void
}

/** X Welcome with the app's icon, name and opening statement, and its suggested questions as Prompts (spec §5.2). */
export default function WelcomePanel({ visible, disabled, onPrompt }: WelcomePanelProps) {
	const { app, site, parameters } = useAppContext()
	if (!visible) return null
	const name = site.title || app.name
	const questions = parameters.suggested_questions ?? []
	return (
		<div className={styles.welcome}>
			<Flex
				vertical
				gap="middle"
			>
				<Welcome
					variant="borderless"
					icon={
						<AppAvatar
							size="large"
							alt={name}
						/>
					}
					title={name}
					description={
						parameters.opening_statement ? (
							<MessageMarkdown content={parameters.opening_statement} />
						) : undefined
					}
				/>
				{questions.length > 0 && (
					<Prompts
						wrap
						items={questions.map((question, index) => ({
							key: String(index),
							label: question,
							disabled,
						}))}
						onItemClick={info => onPrompt(String(info.data.label))}
					/>
				)}
			</Flex>
		</div>
	)
}
