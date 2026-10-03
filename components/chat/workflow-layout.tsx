import { CopyOutlined } from '@ant-design/icons'
import { XStream } from '@ant-design/x-sdk'
import {
	EventEnum,
	IAgentMessage,
	IChunkChatCompletionResponse,
	IErrorEvent,
	IMessageFileItem,
	IWorkflowNode,
} from '@/lib/api'
import { AppModeEnums, useDifyChatStore } from '@/lib/core'
import { copyToClipboard } from '@toolkit-fe/clipboard'
import { Button, Empty, Form, message, Tabs, Tooltip } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
	AppInfo,
	AppInputForm,
	MarkdownRenderer,
	MessageFileList,
	WorkflowLogs,
} from '@/components/chat/chatbox/exports'
import { LucideIcon } from '@/components/shared'

/**
 * 工作流应用详情布局
 */
export default function WorkflowLayout() {
	const { t } = useTranslation()
	const { difyApi } = useDifyChatStore()
	const [entryForm] = Form.useForm()
	const currentApp = useDifyChatStore(s => s.currentApp)
	const [text, setText] = useState('')
	const [workflowStatus, setWorkflowStatus] = useState<'running' | 'finished'>()
	const [workflowItems, setWorkflowItems] = useState<IWorkflowNode[]>([])
	const [resultDetail, setResultDetail] = useState<Record<string, string>>({})
	const [textGenerateStatus, setTextGenerateStatus] = useState<'init' | 'running' | 'finished'>(
		'init',
	)
	const [files, setFiles] = useState<IMessageFileItem[]>([])

	const appMode = currentApp?.config?.info?.mode

	const handleTriggerWorkflow = async (values: Record<string, unknown>) => {
		const runner = () => {
			if (appMode === AppModeEnums.WORKFLOW) {
				return difyApi!.runWorkflow({
					inputs: values,
				})
			} else if (appMode === AppModeEnums.TEXT_GENERATOR) {
				return difyApi!.completion({
					inputs: values,
				})
			}
			return Promise.reject(t('common.unsupported_app_type_with_mode', { mode: appMode }))
		}

		runner()
			.then(async (res: any) => {
				const readableStream = XStream({
					readableStream: res.body as NonNullable<ReadableStream>,
				})
				const reader = readableStream.getReader()
				let result = ''
				const workflows: IAgentMessage['workflows'] = {}
				while (reader) {
					const { value: chunk, done } = await reader.read()
					if (done) {
						setWorkflowStatus('finished')
						break
					}
					if (!chunk) continue
					if (chunk.data) {
						let parsedData = {} as {
							id: string
							task_id: string
							position: number
							tool: string
							tool_input: string
							observation: string
							message_files: string[]

							event: IChunkChatCompletionResponse['event'] | 'text_chunk'
							answer: string
							conversation_id: string
							message_id: string

							// 类型
							type: 'image'
							// 图片链接
							url: string

							data: {
								// 工作流节点的数据
								id: string
								node_type: IWorkflowNode['type']
								title: string
								inputs: string
								outputs: Record<string, string>
								process_data: string
								elapsed_time: number
								execution_metadata: IWorkflowNode['execution_metadata']
								text?: string
							}
						}
						try {
							parsedData = JSON.parse(chunk.data)
						} catch (error) {
							console.error('Failed to parse JSON', error)
						}

						const innerData = parsedData.data

						if (parsedData.event === 'text_chunk') {
							setText(prev => {
								return prev + parsedData.data.text
							})
						}

						if (parsedData.event === EventEnum.WORKFLOW_STARTED) {
							workflows.status = 'running'
							workflows.nodes = []
							setWorkflowStatus('running')
							setWorkflowItems([])
						} else if (parsedData.event === EventEnum.WORKFLOW_FINISHED) {
							// @ts-expect-error FIXME: 类型兼容							workflows.status = 'finished'
							const { outputs, files } = parsedData.data || {}
							const outputsLength = Object.keys(outputs)?.length
							if (outputsLength > 0) {
								setResultDetail(outputs)
							}
							// 如果返回的对象只有一个属性, 则在 "结果" Tab 中渲染其值
							if (outputsLength === 1) {
								if (typeof Object.values(outputs)[0] === 'string') {
									setText(Object.values(outputs)[0] as string)
								}
								if (files) {
									setFiles(files)
								}
							}
							setWorkflowStatus('finished')
						} else if (parsedData.event === EventEnum.WORKFLOW_NODE_STARTED) {
							setWorkflowItems(prev => {
								return [
									...prev,
									{
										id: innerData.id,
										status: 'running',
										type: innerData.node_type,
										title: innerData.title,
									} as IWorkflowNode,
								]
							})
						} else if (parsedData.event === EventEnum.WORKFLOW_NODE_FINISHED) {
							setWorkflowItems(prev => {
								return prev.map(item => {
									if (item.id === innerData.id) {
										return {
											...item,
											status: 'success',
											inputs: innerData.inputs,
											outputs: innerData.outputs,
											process_data: innerData.process_data,
											elapsed_time: innerData.elapsed_time,
											execution_metadata: innerData.execution_metadata,
										}
									}
									return item
								})
							})
						}
						if (parsedData.event === EventEnum.MESSAGE_FILE) {
							result += `<img src="${parsedData.url}" />`
						}
						if (parsedData.event === EventEnum.MESSAGE) {
							const text = parsedData.answer
							if (textGenerateStatus === 'init') {
								setTextGenerateStatus('running')
							}
							setText(prev => {
								return prev + text
							})
							result += text
						}
						if (parsedData.event === EventEnum.MESSAGE_END) {
							if (parsedData.event === EventEnum.MESSAGE_END) {
								setText(result)
								setTextGenerateStatus('finished')
							}
							setText(result)
						}
						if (parsedData.event === EventEnum.ERROR) {
							message.error((parsedData as unknown as IErrorEvent).message)
						}
					}
				}
			})
			.catch((err: any) => {
				console.log('runWorkflow err', err)
				setWorkflowStatus(undefined)
			})
	}

	const resultDetailLength = Object.keys(resultDetail).length

	const resultItems = [
		{
			key: 'result',
			label: t('workflow.result'),
			children: (
				<div className="h-full w-full overflow-x-hidden overflow-y-auto">
					{text ? (
						<MarkdownRenderer markdownText={text} />
					) : files ? (
						<MessageFileList files={files} />
					) : null}
				</div>
			),
			visible: text || resultDetailLength === 1,
		},
		{
			key: 'detail',
			label: t('workflow.detail'),
			children: (
				<div className="w-full">
					<LucideIcon
						className="cursor-pointer"
						name="copy"
						onClick={async () => {
							await copyToClipboard(JSON.stringify(resultDetail, null, 2))
							message.success(t('common.copied_to_clipboard'))
						}}
					/>
					<pre className="bg-theme-code-block-bg box-border w-full overflow-auto rounded-lg p-3">
						{JSON.stringify(resultDetail, null, 2)}
					</pre>
				</div>
			),
			visible: resultDetailLength > 0,
		},
	].filter(item => item.visible)

	return (
		<div className="block h-full w-full overflow-y-auto md:flex md:items-stretch md:overflow-y-hidden">
			{/* 参数填写区域 */}
			<div className="border-theme-border overflow-hidden border-0 border-r border-solid pb-6 md:flex-1 md:pb-0">
				<div className="px-2">
					<AppInfo />
				</div>
				<div className="mt-6 px-6">
					<AppInputForm
						onStartConversation={values => {
							console.log('onStartConversation', values)
						}}
						formFilled={false}
						entryForm={entryForm}
					/>
				</div>
				<div className="flex justify-end px-6">
					<Button
						type="primary"
						onClick={async () => {
							await entryForm.validateFields()
							const values = await entryForm.getFieldsValue()
							setResultDetail({})
							setWorkflowItems([])
							setWorkflowStatus('running')
							setText('')
							handleTriggerWorkflow(values)
						}}
						loading={workflowStatus === 'running'}
					>
						{t('workflow.run')}
					</Button>
				</div>
			</div>

			{/* 工作流执行输出区域 */}
			{appMode === AppModeEnums.WORKFLOW && (
				<div className="overflow-x-hidden overflow-y-auto px-4 pt-6 md:flex-1">
					{!workflowItems?.length && workflowStatus !== 'running' ? (
						<div className="flex h-full w-full items-center justify-center">
							<Empty description={t('workflow.empty_hint')} />
						</div>
					) : (
						<>
							<WorkflowLogs
								className="mt-0"
								status={workflowStatus}
								items={workflowItems}
							/>
							{resultItems?.length ? <Tabs items={resultItems} /> : null}
						</>
					)}
				</div>
			)}

			{/* 文本生成结果渲染 */}
			{appMode === AppModeEnums.TEXT_GENERATOR && (
				<div className="bg-theme-bg relative overflow-x-hidden overflow-y-auto px-4 pt-6 md:flex-1">
					{textGenerateStatus === 'init' ? (
						<div className="flex h-full w-full items-center justify-center">
							<Empty description={t('workflow.empty_hint')} />
						</div>
					) : (
						<>
							<MarkdownRenderer markdownText={text} />
							<Tooltip title={t('workflow.copy_content')}>
								<CopyOutlined
									className="absolute top-6 right-6 cursor-pointer"
									onClick={async () => {
										await copyToClipboard(text)
										message.success(t('common.copied_to_clipboard'))
									}}
								/>
							</Tooltip>
						</>
					)}
				</div>
			)}
		</div>
	)
}
