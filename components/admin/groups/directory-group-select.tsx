'use client'

import { useDebounceFn, useUnmount } from 'ahooks'
import { App, Select, Spin, Typography, theme } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
	DIRECTORY_GROUPS_MAX,
	DIRECTORY_SEARCH_MIN,
	directorySearchText,
} from '@/app/(admin)/group-management/schemas'
import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import { readDifyError } from '@/lib/dify/browser'
import type { DirectoryGroupOption } from '@/lib/directory/admin'
import { DIRECTORY_GROUP_SEARCH_LIMIT } from '@/lib/directory-status'

import { directorySearchErrorKey } from './group-errors'

/** A picked directory group as the Select holds it (antd Select `labelInValue`: the value is `{ value, label }`). */
export type DirectoryGroupValue = { value: string; label: string }

/**
 * The directory groups field (spec §6.5): a debounced remote search of GET /api/directory/groups (decision al), after
 * antd's "Search and Select Users" demo, which fetches its options the same way. Each search aborts the one before it
 * (MDN AbortController), so only the latest answer is shown, and leaving the drawer aborts the last one (ahooks
 * `useUnmount`). Form.Item hands its control an `id`, which the label's `for` and `scrollToField` need (antd Form FAQ:
 * "Make sure that it hasn't been ignored in your custom form control"). At most 50 picks, the save's bound (antd Select
 * `maxCount`).
 */
export default function DirectoryGroupSelect({
	id,
	value,
	onChange,
}: {
	id?: string
	value?: DirectoryGroupValue[]
	onChange?: (value: DirectoryGroupValue[]) => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [options, setOptions] = useState<DirectoryGroupValue[]>([])
	const [fetching, setFetching] = useState(false)
	const [limited, setLimited] = useState(false)
	const [tooShort, setTooShort] = useState(true)
	const { token } = theme.useToken()
	const request = useRef<AbortController | null>(null)
	useUnmount(() => request.current?.abort())
	const { run: search } = useDebounceFn(
		async (text: string) => {
			request.current?.abort()
			request.current = null
			setOptions([])
			setLimited(false)
			// Decision al: never over the route's 64 code points, so its 400 cannot come back.
			const q = directorySearchText(text)
			// Counted in code points, as the route's zod `min` counts them.
			const short = Array.from(q).length < DIRECTORY_SEARCH_MIN
			setTooShort(short)
			setFetching(!short)
			// Decision al: a text under two characters never reaches the directory (the route refuses it too).
			if (short) return
			const controller = new AbortController()
			request.current = controller
			try {
				const response = await fetch(`/api/directory/groups?${new URLSearchParams({ q })}`, {
					signal: controller.signal,
				})
				if (!response.ok) {
					// The envelope's code, never its English message (charter §4.5).
					const { code } = await readDifyError(response)
					if (!controller.signal.aborted) message.error(t(directorySearchErrorKey(code)))
					return
				}
				const groups = (await response.json()) as DirectoryGroupOption[]
				if (controller.signal.aborted) return
				setOptions(groups.map(group => ({ value: group.key, label: group.name })))
				setLimited(groups.length >= DIRECTORY_GROUP_SEARCH_LIMIT)
			} catch {
				// An aborted search was replaced or left; anything else is a network failure.
				if (!controller.signal.aborted) message.error(t(directorySearchErrorKey(undefined)))
			} finally {
				if (request.current === controller) {
					request.current = null
					setFetching(false)
				}
			}
		},
		{ wait: 300 },
	)
	return (
		<Select
			id={id}
			mode="multiple"
			labelInValue
			value={value}
			onChange={onChange}
			options={options}
			maxCount={DIRECTORY_GROUPS_MAX}
			getPopupContainer={drawerPopupContainer}
			showSearch={{ filterOption: false, onSearch: search, autoClearSearchValue: false }}
			notFoundContent={
				fetching ? (
					<Spin size="small" />
				) : (
					t(
						tooShort
							? 'admin_groups.directory_groups_placeholder'
							: 'admin_groups.directory_groups_none',
					)
				)
			}
			// Decision al: twenty answers may not be all; the list says so (antd Select `popupRender`, 5.25.0).
			popupRender={menu => (
				<>
					{menu}
					{limited && (
						<Typography.Paragraph
							type="secondary"
							style={{ margin: 0, padding: `${token.paddingXS}px ${token.paddingSM}px` }}
						>
							{t('admin_groups.directory_groups_limited', { limit: DIRECTORY_GROUP_SEARCH_LIMIT })}
						</Typography.Paragraph>
					)}
				</>
			)}
			placeholder={t('admin_groups.directory_groups_placeholder')}
		/>
	)
}
