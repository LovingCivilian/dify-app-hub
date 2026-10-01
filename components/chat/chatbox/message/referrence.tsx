import {
	AimOutlined,
	FileOutlined,
	FileWordOutlined,
	IeOutlined,
	ShareAltOutlined,
	StarOutlined,
} from '@ant-design/icons'
import { IRetrieverResource } from '@/lib/api'
import { useIsMobile } from '@/lib/helpers'
import { Divider, Popover, Space, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

interface IRetrieverResourceGroupedItem {
	id: string
	name: string
	data_source_type: IRetrieverResource['data_source_type']
	items: IRetrieverResource[]
}

interface IMetricItemProps {
	icon: React.ReactNode
	title: string
	value: string | number
}

/**
 * 知识库引用的指标项目
 */
const MetricItem = (props: IMetricItemProps) => {
	return (
		<Tooltip
			title={props.title}
			arrow
		>
			<div className="flex items-center">
				{props.icon}
				<span className="ml-1 flex-1 truncate">{props.value}</span>
			</div>
		</Tooltip>
	)
}

const ReferenceItem = (props: IRetrieverResourceGroupedItem) => {
	const { t } = useTranslation()
	const isMobile = useIsMobile()
	return (
		<div
			className="flex items-center text-gray-600"
			title={props.name}
		>
			<Popover
				trigger={['click']}
				classNames={{
					content: 'max-h-[40vh] max-w-[85vw] md:max-w-[50vw] overflow-y-auto overflow-x-hidden',
				}}
				title={
					<div
						title={props.name}
						className="w-full truncate"
					>
						{props.name}
					</div>
				}
				placement={isMobile ? 'top' : 'topLeft'}
				content={
					<Space
						className="w-full overflow-hidden"
						split={
							<Divider
								style={{
									margin: '10px 0',
								}}
								variant="dotted"
								type="horizontal"
							/>
						}
						direction="vertical"
					>
						{props.items.map(item => {
							return (
								<div
									className="w-full overflow-hidden"
									key={item.id}
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center">
											<span className="text-desc">#{item.segment_position}</span>
										</div>
										{/* TODO: 需要添加应用配置：知识库 BaseURL 才能支持跳转 */}
										{/* <a
												target="_blank"
												rel="noreferrer"
												href={`https://cloud.dify.ai/datasets/${item.dataset_id}/documents/${item.document_id}`}
											>
												跳转到知识库 <ArrowRightOutlined className="ml-2" />
											</a> */}
									</div>
									<div className="mt-2 w-full overflow-hidden">
										<div>{item.content}</div>
										<Space
											size="middle"
											className="text-desc mt-2 flex w-full flex-wrap items-center overflow-hidden"
										>
											{[
												{
													id: `${item.segment_id}_word_count`,
													icon: <FileWordOutlined />,
													title: t('message.reference.word_count', { value: item.word_count }),
													value: item.word_count,
													visible: !!item.word_count,
												},
												{
													id: `${item.segment_id}_hit_count`,
													icon: <AimOutlined />,
													title: t('message.reference.hit_count', { value: item.hit_count }),
													value: item.hit_count,
													visible: !!item.hit_count,
												},
												{
													id: `${item.segment_id}_index_node_hash`,
													icon: <ShareAltOutlined />,
													title: t('message.reference.vector_hash', {
														value: item.index_node_hash,
													}),
													value: item.index_node_hash?.substring(0, 7),
													visible: !!item.index_node_hash,
												},
												{
													id: `${item.segment_id}_score`,
													icon: <StarOutlined />,
													title: t('message.reference.score', { value: item.score }),
													value: item.score,
													visible: !!item.score,
												},
											]
												.filter(item => {
													return item.visible
												})
												.map(metric => (
													<MetricItem
														key={metric.id}
														icon={metric.icon}
														title={metric.title}
														value={metric.value}
													/>
												))}
										</Space>
									</div>
								</div>
							)
						})}
					</Space>
				}
			>
				{props.data_source_type === 'website_crawl' ? (
					<IeOutlined />
				) : props.data_source_type === 'upload_file' ? (
					<FileOutlined />
				) : null}
				<span className="ml-1 cursor-pointer hover:underline">{props.name}</span>
			</Popover>
		</div>
	)
}

interface IMessageReferrenceProps {
	/**
	 * 消息引用链接列表
	 */
	items?: IRetrieverResource[]
}

/**
 * 消息引用链接列表
 */
export default function MessageReferrence(props: IMessageReferrenceProps) {
	const { t } = useTranslation()
	const { items } = props

	if (!items?.length) {
		return null
	}

	const groupedItems: IRetrieverResourceGroupedItem[] = items.reduce((acc, item) => {
		const documentId = item.document_id
		const matchedItem = acc.find(item => item.id === documentId)
		if (!matchedItem) {
			acc.push({
				id: item.document_id,
				name: item.document_name,
				data_source_type: item.data_source_type,
				items: [item],
			})
		} else {
			matchedItem.items.push(item)
		}
		return acc
	}, [] as IRetrieverResourceGroupedItem[])

	return (
		<div className="pb-3">
			<div className="flex items-center text-gray-400">
				<span className="mr-3 text-sm">{t('message.reference.title')}</span>
				<div className="h-0 flex-1 border-0 border-t border-dashed border-gray-400" />
			</div>
			{groupedItems.map(item => {
				return (
					<div
						className="mt-2 truncate"
						key={item.id}
					>
						<ReferenceItem {...item} />
					</div>
				)
			})}
		</div>
	)
}
