import { DifyApi, IAnnotationItem } from '@/lib/api'
import { IDifyAppItem } from '@/lib/core'
import { useRequest } from 'ahooks'
import { Button, Drawer, Form, Input, message, Popconfirm, Popover, Space, Table } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface IAnnotationManagerDrawerProps {
	open: boolean
	onClose: () => void
	appItem?: IDifyAppItem
}

const DEFAULT_PAGE_SIZE = 10

export const AnnotationManagerDrawer = (props: IAnnotationManagerDrawerProps) => {
	const { t } = useTranslation()
	const { open, onClose, appItem } = props
	const [difyApi, setDifyApi] = useState<DifyApi>()

	// State for Add/Edit Modal
	const [modalOpen, setModalOpen] = useState(false)
	const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
	const [currentAnnotation, setCurrentAnnotation] = useState<IAnnotationItem>()
	const [form] = Form.useForm()

	// Initialize DifyApi when appItem changes
	useEffect(() => {
		if (appItem) {
			setDifyApi(
				new DifyApi({
					...appItem.requestConfig,
					user: '', // User is not needed for annotation management
				}),
			)
		}
	}, [appItem])

	// Fetch List
	const {
		data,
		loading,
		run: fetchList,
		refresh,
		params,
	} = useRequest(
		async (params: { page: number; limit: number }) => {
			if (!difyApi) return { list: [], total: 0 }
			const res = await difyApi.getAnnotationList(params)
			return {
				list: res.data,
				total: res.total,
			}
		},
		{
			manual: true,
			defaultParams: [{ page: 1, limit: DEFAULT_PAGE_SIZE }],
		},
	)

	// Trigger fetch when open or difyApi ready
	useEffect(() => {
		if (open && difyApi) {
			fetchList({ page: 1, limit: DEFAULT_PAGE_SIZE })
		}
	}, [open, difyApi, fetchList])

	// Handlers
	const handleEdit = (record: IAnnotationItem) => {
		setCurrentAnnotation(record)
		setModalMode('edit')
		form.setFieldsValue({
			question: record.question,
			answer: record.answer,
		})
		setModalOpen(true)
	}

	const handleDelete = async (id: string) => {
		if (!difyApi) return
		try {
			await difyApi.deleteAnnotation(id)
			message.success(t('common.delete_success'))
			refresh()
		} catch (e) {
			message.error(t('common.delete_failed'))
			console.error(e)
		}
	}

	const handleModalOk = async () => {
		if (!difyApi) return
		try {
			const values = await form.validateFields()
			if (modalMode === 'create') {
				await difyApi.createAnnotation(values)
				message.success(t('common.create_success'))
			} else {
				await difyApi.updateAnnotation(currentAnnotation!.id, values)
				message.success(t('common.update_success'))
			}
			setModalOpen(false)
			refresh()
		} catch (e) {
			console.error(e)
			message.error(t('common.operation_failed'))
		}
	}

	// Table Columns
	const columns = [
		{
			title: t('annotation.question'),
			dataIndex: 'question',
			key: 'question',
			width: 200,
			render: (text: string) => (
				<Popover
					content={
						<div
							style={{
								maxWidth: 400,
								maxHeight: 300,
								overflow: 'auto',
								whiteSpace: 'pre-wrap',
							}}
						>
							{text}
						</div>
					}
					title={null}
				>
					<div
						style={{
							display: '-webkit-box',
							WebkitLineClamp: 3,
							WebkitBoxOrient: 'vertical',
							overflow: 'hidden',
							cursor: 'pointer',
							wordBreak: 'break-all',
						}}
					>
						{text}
					</div>
				</Popover>
			),
		},
		{
			title: t('annotation.answer'),
			dataIndex: 'answer',
			key: 'answer',
			width: 200,
			render: (text: string) => (
				<Popover
					content={
						<div
							style={{
								maxWidth: 400,
								maxHeight: 300,
								overflow: 'auto',
								whiteSpace: 'pre-wrap',
							}}
						>
							{text}
						</div>
					}
					title={null}
				>
					<div
						style={{
							display: '-webkit-box',
							WebkitLineClamp: 3,
							WebkitBoxOrient: 'vertical',
							overflow: 'hidden',
							cursor: 'pointer',
							wordBreak: 'break-all',
						}}
					>
						{text}
					</div>
				</Popover>
			),
		},
		{
			title: t('annotation.hit_count'),
			dataIndex: 'hit_count',
			key: 'hit_count',
			width: 100,
		},
		{
			title: t('common.created_at'),
			dataIndex: 'created_at',
			key: 'created_at',
			render: (val: number) => new Date(val * 1000).toLocaleString(),
			width: 180,
		},
		{
			title: t('common.actions'),
			key: 'action',
			width: 120,
			render: (_: unknown, record: IAnnotationItem) => (
				<Space>
					<Button
						className="!px-0"
						type="link"
						onClick={() => handleEdit(record)}
					>
						{t('common.edit')}
					</Button>
					<Popconfirm
						title={t('annotation.delete_confirm')}
						onConfirm={() => handleDelete(record.id)}
					>
						<Button
							className="!px-0"
							type="link"
							danger
						>
							{t('common.delete')}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	]

	return (
		<Drawer
			title={t('admin_apps.annotations')}
			size={1000}
			open={open}
			onClose={onClose}
			extra={
				<Button
					type="primary"
					onClick={() => {
						setModalMode('create')
						form.resetFields()
						setModalOpen(true)
					}}
				>
					{t('annotation.add')}
				</Button>
			}
		>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={data?.list}
				loading={loading}
				className="w-full overflow-auto"
				pagination={{
					current: params?.[0]?.page || 1,
					pageSize: params?.[0]?.limit || DEFAULT_PAGE_SIZE,
					total: data?.total,
					showSizeChanger: true,
					pageSizeOptions: ['10', '20', '50', '100'],
					showTotal: total => t('common.total_items', { total }),
					onChange: (page, pageSize) => fetchList({ page, limit: pageSize }),
				}}
			/>

			<Drawer
				title={modalMode === 'create' ? t('annotation.add') : t('annotation.edit')}
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				size={600}
				extra={
					<Space>
						<Button onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
						<Button
							type="primary"
							onClick={handleModalOk}
						>
							{t('common.ok')}
						</Button>
					</Space>
				}
			>
				<Form
					form={form}
					layout="vertical"
				>
					<Form.Item
						name="question"
						label={t('annotation.question')}
						rules={[{ required: true, message: t('annotation.question_required') }]}
					>
						<Input.TextArea rows={3} />
					</Form.Item>
					<Form.Item
						name="answer"
						label={t('annotation.answer')}
						rules={[{ required: true, message: t('annotation.answer_required') }]}
					>
						<Input.TextArea autoSize={{ minRows: 3, maxRows: 15 }} />
					</Form.Item>
				</Form>
			</Drawer>
		</Drawer>
	)
}
