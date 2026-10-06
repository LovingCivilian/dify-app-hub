import { Skeleton } from 'antd'

// Inside AdminShell: the admin layout renders the shell, loading.tsx wraps the page only (loading.md).
export default function AdminLoading() {
	return (
		<Skeleton
			active
			paragraph={{ rows: 8 }}
		/>
	)
}
