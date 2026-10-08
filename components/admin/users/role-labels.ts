import type { Role } from '@/lib/auth/roles'

/** Each role's label key (ADR-0024), for the table's tags and the drawer's options. */
export const ROLE_LABEL_KEYS = {
	owner: 'admin_users.role_owner',
	admin: 'admin_users.role_admin',
	user: 'admin_users.role_user',
} as const satisfies Record<Role, string>
