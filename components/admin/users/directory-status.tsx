'use client'

import { SyncOutlined } from '@ant-design/icons'
import { App, Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import { syncDirectoryAction } from '@/app/(admin)/user-management/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { DirectoryStatusDto } from '@/lib/directory/admin'

import {
	OUTCOME_COLORS,
	OUTCOME_LABEL_KEYS,
	syncErrorKey,
	TRIGGER_LABEL_KEYS,
} from './directory-labels'
import { userErrorKey } from './user-errors'

/**
 * The directory's status on the users page (spec §6.6): the connection's encryption, the next run, the last run with
 * its counts, and Sync now. Shown to accounts with admin rights while LDAP is configured (the page passes null otherwise).
 */
export default function DirectoryStatus({ status }: { status: DirectoryStatusDto }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()
	const last = status.lastRun

	const syncNow = () =>
		run(async () => {
			const result = await syncDirectoryAction()
			if (!result.ok) {
				message.error(t(userErrorKey(result.code)))
				return
			}
			const { outcome, counts, errorCode } = result.data
			if (outcome === 'succeeded')
				message.success(
					t('admin_users.sync_succeeded', {
						deactivated: counts.deactivated,
						reactivated: counts.reactivated,
					}),
				)
			else if (outcome === 'failed')
				message.error(t('admin_users.sync_failed', { reason: t(syncErrorKey(errorCode ?? '')) }))
			else
				message.warning(
					t(
						outcome === 'empty'
							? 'admin_users.sync_stopped_empty'
							: 'admin_users.sync_stopped_id_attribute',
					),
				)
		})

	// A named section is a landmark `region` (HTML-AAM), so the panel is found by its role and name.
	return (
		<section aria-label={t('admin_users.directory_title')}>
			<Card
				size="small"
				title={t('admin_users.directory_title')}
				extra={
					<Button
						icon={<SyncOutlined />}
						loading={pending}
						onClick={() => void syncNow()}
					>
						{t('admin_users.sync_now')}
					</Button>
				}
			>
				<Descriptions
					size="small"
					column={{ xs: 1, md: 2 }}
					items={[
						{
							key: 'connection',
							label: t('admin_users.directory_connection'),
							children:
								status.encryption === 'none' ? (
									<Tag color="warning">{t('admin_users.directory_unencrypted')}</Tag>
								) : (
									<Tag color="success">
										{t(
											status.encryption === 'ldaps'
												? 'admin_users.directory_ldaps'
												: 'admin_users.directory_starttls',
										)}
									</Tag>
								),
						},
						{
							key: 'next',
							label: t('admin_users.directory_next_run'),
							children: status.nextRun ? (
								<ClientDateTime value={status.nextRun} />
							) : (
								t('admin_users.directory_schedule_off')
							),
						},
						{
							key: 'last',
							label: t('admin_users.directory_last_run'),
							children: last ? (
								<Space wrap>
									<ClientDateTime value={last.startedAt} />
									<Tag>{t(TRIGGER_LABEL_KEYS[last.trigger])}</Tag>
									<Tag color={OUTCOME_COLORS[last.outcome]}>
										{t(OUTCOME_LABEL_KEYS[last.outcome])}
									</Tag>
									{last.errorCode && (
										<Typography.Text type="danger">
											{t(syncErrorKey(last.errorCode))}
										</Typography.Text>
									)}
								</Space>
							) : (
								t('admin_users.directory_never_run')
							),
						},
						{
							key: 'counts',
							label: t('admin_users.directory_counts'),
							children: last ? t('admin_users.directory_counts_value', { ...last.counts }) : '—',
						},
					]}
				/>
			</Card>
		</section>
	)
}
