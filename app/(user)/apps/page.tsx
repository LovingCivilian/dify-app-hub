'use client'

import { TagOutlined } from '@ant-design/icons'
import { AppModeLabels } from '@/lib/core'
import { useIsMobile } from '@/lib/helpers'
import { useRequest } from 'ahooks'
import { Col, Empty, message, Row, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import { LucideIcon } from '@/components/shared'
import UserShell from '@/components/shell/user-shell'
import appService from '@/services/app'

export default function AppListPage() {
	const { t } = useTranslation()
	const router = useRouter()
	const isMobile = useIsMobile()

	const { data: list } = useRequest(() => appService.getApps(), {
		onError: error => {
			message.error(t('app.fetch_list_failed', { error }))
			console.error(error)
		},
	})

	return (
		<UserShell>
			<div className="box-border flex min-h-full flex-col px-3 py-6 md:px-6">
				<Typography.Title level={4}>{t('app.list')}</Typography.Title>
				{list?.length ? (
					<Row gutter={[16, 16]}>
						{list.map(item => {
							if (!item.info) {
								return (
									<Col
										key={item.id}
										span={isMobile ? 24 : 6}
									>
										<div className="hover:border-primary bg-theme-main-bg border-theme text-theme-text cursor-pointer rounded-2xl border p-3">
											{t('app.info_missing')}
										</div>
									</Col>
								)
							}
							const hasTags = item.info.tags?.length
							return (
								<Col
									key={item.id}
									span={isMobile ? 24 : 6}
								>
									<div
										className="hover:border-primary hover:text-primary bg-theme-main-bg border-theme cursor-pointer rounded-2xl border p-3"
										onClick={() => router.push(`/chat/${item.id}`)}
									>
										<div className="flex items-center overflow-hidden">
											<div className="border-theme bg-theme-btn-bg flex h-10 w-10 items-center justify-center rounded-lg border">
												<LucideIcon
													name="bot"
													className="text-theme-text text-xl"
												/>
											</div>
											<div className="ml-3 flex-1 overflow-hidden">
												<div className="text-theme-text truncate font-semibold">
													{item.info.name}
												</div>
												<div className="text-theme-desc text-xs">
													{item.info.mode ? AppModeLabels[item.info.mode] : 'unknown'}
												</div>
											</div>
										</div>
										<div className="text-theme-desc mt-3 line-clamp-2 text-sm">
											{item.info.description || t('app.no_description_user')}
										</div>
										<div className="text-theme-desc mt-3 flex items-center truncate text-xs">
											{hasTags && (
												<>
													<TagOutlined className="mr-2" />
													{item.info.tags.join('、')}
												</>
											)}
										</div>
									</div>
								</Col>
							)
						})}
					</Row>
				) : (
					<div className="flex flex-1 items-center justify-center">
						<Empty description={t('app.empty_contact_admin')} />
					</div>
				)}
			</div>
		</UserShell>
	)
}
