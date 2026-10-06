import AppGallerySkeleton from '@/components/apps/app-gallery-skeleton'
import UserShell from '@/components/shell/user-shell'

// The page renders its own shell (the chat passes header slots), so the loading state does too (spec §3.3).
export default function AppListLoading() {
	return (
		<UserShell>
			<AppGallerySkeleton />
		</UserShell>
	)
}
