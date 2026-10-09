import type { UserOption } from '@/lib/data/users'

/** An account as an admin picker lists it (decision e): name and email, the email alone, and a deactivated tag. */
export const accountOptionLabel = (user: UserOption, deactivatedLabel: string): string => {
	const label = user.name ? `${user.name} (${user.email})` : user.email
	return user.active ? label : `${label} · ${deactivatedLabel}`
}
