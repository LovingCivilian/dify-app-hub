import { useSession } from 'next-auth/react'

/**
 * Chat-side identity: the signed-in account's email, which the server also uses as the Dify
 * end-user id. The route group layouts gate access on the server (ADR-0018), so this hook no
 * longer reports loading or authorised states.
 */
export const useAuth = () => {
	const { data: session } = useSession()
	return { userId: session?.user?.email ?? undefined }
}
