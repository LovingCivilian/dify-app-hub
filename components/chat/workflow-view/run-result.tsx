'use client'

import { Actions } from '@ant-design/x'
import { Empty, Flex, Result, Tabs, Typography } from 'antd'
import type { TabsProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { displayRunWorkflow, type RunState } from '../hooks/run-reducer'
import MessageFiles from '../message/message-files'
import MessageMarkdown from '../message/message-markdown'
import WorkflowLogs from '../message/workflow-logs'
import styles from './workflow-view.module.css'

/** X's copy action (antd's Typography copy button, named by antd's locale: "Copy"). */
const CopyAction = ({ text }: { text: string }) => (
	<Actions items={[{ key: 'copy', actionRender: () => <Actions.Copy text={text} /> }]} />
)

/**
 * The run's output (spec §5.4): `Empty` before the first run; for workflow apps the node logs and the
 * result and detail tabs, for completion apps the generated Markdown; `Result` when the run failed.
 */
export default function RunResult({
	state,
	workflowApp,
}: {
	state: RunState
	workflowApp: boolean
}) {
	const { t } = useTranslation()
	if (state.status === 'idle') return <Empty description={t('workflow.empty_hint')} />

	const running = state.status === 'running'
	const workflow = workflowApp ? displayRunWorkflow(state) : undefined
	// Keyed by run: each run's logs open afresh.
	const logs = workflow ? (
		<WorkflowLogs
			key={state.runId}
			workflow={workflow}
			defaultOpen
		/>
	) : null

	if (state.status === 'failed') {
		return (
			<Flex
				vertical
				gap="middle"
			>
				{logs}
				<Result
					status="error"
					title={t('workflow.failed')}
					subTitle={state.error || t('common.request_failed_retry')}
				/>
			</Flex>
		)
	}

	const stopped = state.status === 'stopped' && (
		<Typography.Text type="secondary">{t('workflow.stopped')}</Typography.Text>
	)
	const hasFiles = Boolean(state.files?.length)
	// The text can be copied once it is complete (or stopped).
	const result = (
		<Flex
			vertical
			gap="small"
		>
			{state.text && (
				<MessageMarkdown
					content={state.text}
					streaming={running}
				/>
			)}
			{hasFiles && <MessageFiles files={state.files} />}
			{state.text && !running && <CopyAction text={state.text} />}
		</Flex>
	)

	if (!workflowApp) {
		return (
			<Flex
				vertical
				gap="small"
			>
				{result}
				{stopped}
			</Flex>
		)
	}

	const detail = state.outputs ? JSON.stringify(state.outputs, null, 2) : ''
	const items: NonNullable<TabsProps['items']> = []
	if (state.text || hasFiles)
		items.push({ key: 'result', label: t('workflow.result'), children: result })
	if (detail) {
		items.push({
			key: 'detail',
			label: t('workflow.detail'),
			children: (
				<Flex
					vertical
					gap="small"
				>
					<pre className={styles.code}>{detail}</pre>
					<CopyAction text={detail} />
				</Flex>
			),
		})
	}
	return (
		<Flex
			vertical
			gap="middle"
		>
			{logs}
			{stopped}
			{items.length > 0 && <Tabs items={items} />}
		</Flex>
	)
}
