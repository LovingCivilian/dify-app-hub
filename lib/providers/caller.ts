import type { AccountSource } from '@/lib/auth/account-source'
import type { Role } from '@/lib/auth/roles'

/**
 * Who a provider call acts for (Part 2 spec §2.3, §2.4): the account's permanent id (ADR-0026), where its identity lives
 * and its role, the three things the AG-UI provider's JWT carries (`sub`, `auth_source`, `roles`). A verified
 * SessionUser has all three, so the actor itself is the caller (plan call P1). Client-safe: types only.
 */
export interface ProviderCaller {
	id: string
	source: AccountSource
	role: Role
}
