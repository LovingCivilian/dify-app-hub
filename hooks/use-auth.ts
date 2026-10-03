import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

/**
 * Chat-side identity: the signed-in account. `userId` is the account email,
 * which the server also uses as the Dify end-user id.
 */
export const useAuth = () => {
	const router = useRouter()
	const { data: session, status } = useSession()

	return {
		isAuthorized: status === 'authenticated',
		isLoading: status === 'loading',
		goAuthorize: () => router.push('/login'),
		userId: session?.user?.email ?? undefined,
	}
}
