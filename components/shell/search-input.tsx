'use client'

import { SearchOutlined } from '@ant-design/icons'
import { Input } from 'antd'

/** The search box of the app list and the admin tables (spec §4.4); filtering itself is `matchesQuery`. */
export default function SearchInput({
	placeholder,
	value,
	onChange,
}: {
	placeholder: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<Input
			allowClear
			prefix={<SearchOutlined />}
			placeholder={placeholder}
			aria-label={placeholder}
			value={value}
			onChange={event => onChange(event.target.value)}
		/>
	)
}
