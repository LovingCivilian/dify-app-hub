'use client'

import { Skeleton } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/libs/format-date'

/** A timestamp formatted in the browser's time zone and the UI language, after hydration (spec §6). */
export default function ClientDateTime({ value }: { value: string }) {
	const { i18n } = useTranslation()
	const [mounted, setMounted] = useState(false)
	useEffect(() => {
		setMounted(true)
	}, [])
	return (
		<time dateTime={value}>
			{mounted ? (
				formatDateTime(value, i18n.resolvedLanguage)
			) : (
				<Skeleton.Input
					active
					size="small"
				/>
			)}
		</time>
	)
}
