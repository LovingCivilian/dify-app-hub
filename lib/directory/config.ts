import 'server-only'

import { env, type LdapConfig } from '@/lib/env'

/** The `LDAP_*` block (spec §7.1), or null while LDAP is off: the login page, the sign-in and the sync ask here. */
export const directoryConfig = (): LdapConfig | null => env().ldap

export const isDirectoryConfigured = (): boolean => directoryConfig() !== null
