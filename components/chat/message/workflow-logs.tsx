'use client'

import {
	CheckCircleFilled,
	CloseCircleFilled,
	LoadingOutlined,
	PauseCircleFilled,
	ReloadOutlined,
} from '@ant-design/icons'
import { Collapse, Descriptions, Flex, Tag, Typography, theme } from 'antd'
import type { DescriptionsProps } from 'antd'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkflowNode, WorkflowState } from '../provider/message'
import styles from './workflow-logs.module.css'
import WorkflowNodeIcon from './workflow-node-icon'
import { formatCount, formatSeconds, runSummary } from './workflow-summary'

type Status = WorkflowNode['status'] | WorkflowState['status']

/** `workflow.status.*` key per status: the run's `finished` reads as the node's `success`, `error` as `failed`. */
const STATUS_KEYS = {
	running: 'running',
	retrying: 'retrying',
	paused: 'paused',
	success: 'success',
	finished: 'success',
	error: 'failed',
	failed: 'failed',
} as const satisfies Record<Status, string>

const COLLAPSE_CLASS_NAMES = { title: styles.title }

function StatusIcon({ status }: { status: Status }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	// The icon is the only carrier of the status, so it gets an accessible name from the keys.
	const label = t(`workflow.status.${STATUS_KEYS[status]}`)
	switch (status) {
		case 'running':
			return (
				<LoadingOutlined
					spin
					aria-label={label}
				/>
			)
		case 'retrying':
			return (
				<ReloadOutlined
					spin
					style={{ color: token.colorWarning }}
					aria-label={label}
				/>
			)
		case 'paused':
			return (
				<PauseCircleFilled
					style={{ color: token.colorWarning }}
					aria-label={label}
				/>
			)
		case 'success':
		case 'finished':
			return (
				<CheckCircleFilled
					style={{ color: token.colorSuccess }}
					aria-label={label}
				/>
			)
		case 'error':
		case 'failed':
			return (
				<CloseCircleFilled
					style={{ color: token.colorError }}
					aria-label={label}
				/>
			)
	}
}

/** Memoised: a node's JSON is unchanged while later stream events re-render the whole logs. */
const Json = memo(function Json({ value }: { value: unknown }) {
	return (
		<pre className={styles.code}>
			{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
		</pre>
	)
})

/** Chatflow and workflow node logs: antd Collapse → Collapse → Descriptions, token-styled (spec §5.3). */
export default function WorkflowLogs({
	workflow,
	defaultOpen = false,
}: {
	workflow?: WorkflowState
	defaultOpen?: boolean
}) {
	const { t, i18n } = useTranslation()
	// Digits follow the UI language (Arabic-Indic for `ar`, ADR-0005); same input as formatDateTime.
	const language = i18n.resolvedLanguage
	const nodes = workflow?.nodes

	// Rebuilt only when the nodes (a new array per stream event) or the language change, so antd gets
	// stable `items` while other parts of the bubble re-render. Hooks run before the early return.
	const nodeItems = useMemo(() => {
		/** Time and tokens of a node that has finished (a running node has neither yet). */
		const nodeMeta = (node: WorkflowNode) => {
			if (node.status !== 'success' && node.status !== 'error') return ''
			const seconds = formatSeconds(node.elapsedTime, language)
			return [
				seconds ? t('workflow.seconds', { value: seconds }) : '',
				node.totalTokens
					? t('workflow.tokens', { value: formatCount(node.totalTokens, language) })
					: '',
			]
				.filter(Boolean)
				.join(' · ')
		}

		return (nodes ?? []).map(node => {
			// Only the parts the node has: a running node has no inputs, process data or outputs yet.
			const rows: NonNullable<DescriptionsProps['items']> = []
			if (node.inputs != null)
				rows.push({
					key: 'input',
					label: t('workflow.input'),
					children: <Json value={node.inputs} />,
				})
			if (node.processData != null)
				rows.push({
					key: 'process',
					label: t('workflow.process'),
					children: <Json value={node.processData} />,
				})
			if (node.outputs != null)
				rows.push({
					key: 'output',
					label: t('workflow.output'),
					children: <Json value={node.outputs} />,
				})
			if (node.error)
				rows.push({
					key: 'error',
					label: t('workflow.error'),
					children: <Typography.Text type="danger">{node.error}</Typography.Text>,
				})
			const meta = nodeMeta(node)
			return {
				key: node.id,
				label: (
					<Flex
						gap="small"
						align="center"
						className={styles.nodeLabel}
					>
						<StatusIcon status={node.status} />
						<WorkflowNodeIcon type={node.type} />
						<Typography.Text ellipsis>{node.title}</Typography.Text>
						{node.retries ? (
							<Tag>{t('workflow.retries', { times: formatCount(node.retries, language) })}</Tag>
						) : null}
					</Flex>
				),
				extra: meta ? <Typography.Text type="secondary">{meta}</Typography.Text> : null,
				children: rows.length ? (
					<Descriptions
						size="small"
						column={1}
						layout="vertical"
						items={rows}
					/>
				) : null,
			}
		})
	}, [nodes, language, t])

	if (!workflow?.nodes.length) return null
	const summary = runSummary(workflow)

	return (
		<Collapse
			size="small"
			className={styles.root}
			classNames={COLLAPSE_CLASS_NAMES}
			defaultActiveKey={defaultOpen || workflow.status === 'running' ? ['run'] : []}
			items={[
				{
					key: 'run',
					label: (
						<Flex
							gap="small"
							align="center"
							wrap
						>
							<StatusIcon status={workflow.status} />
							<Typography.Text strong>{t('workflow.title')}</Typography.Text>
							<Typography.Text type="secondary">
								{t('workflow.summary', {
									nodes: formatCount(summary.nodes, language),
									seconds: formatSeconds(summary.seconds, language, 2),
									tokens: formatCount(summary.tokens, language),
								})}
							</Typography.Text>
						</Flex>
					),
					children: (
						<Collapse
							size="small"
							ghost
							classNames={COLLAPSE_CLASS_NAMES}
							items={nodeItems}
						/>
					),
				},
			]}
		/>
	)
}
