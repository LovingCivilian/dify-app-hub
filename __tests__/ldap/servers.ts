import { readFileSync } from 'node:fs'

import { Client } from 'ldapts'

import type { LdapConfig } from '@/lib/env'

/** The seeded people's password and the service account's (e2e/fixtures/ldap; test values only). */
export const PASSWORD = 'E2e-Dir-Passw0rd'
const SERVICE_PASSWORD = 'E2e-Svc-Passw0rd'
const CA_FILE = 'e2e/fixtures/ldap/tls/ca.crt'

const ad = {
	caFile: CA_FILE,
	bindDn: 'CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test',
	bindPassword: SERVICE_PASSWORD,
	userBaseDn: 'CN=Users,DC=e2e,DC=hub,DC=test',
	userFilter:
		'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupBaseDn: 'CN=Users,DC=e2e,DC=hub,DC=test',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
	syncSchedule: null,
	syncTimezone: null,
} satisfies Omit<LdapConfig, 'url' | 'encryption'>

const openldap = {
	caFile: CA_FILE,
	bindDn: 'cn=svc-hub,dc=openldap,dc=hub,dc=test',
	bindPassword: SERVICE_PASSWORD,
	userBaseDn: 'ou=people,dc=openldap,dc=hub,dc=test',
	userFilter: '(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))',
	loginAttribute: 'uid',
	idAttribute: 'entryUUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	groupFilter: '(objectClass=groupOfNames)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf={group_dn})',
	syncSchedule: null,
	syncTimezone: null,
} satisfies Omit<LdapConfig, 'url' | 'encryption'>

export const adLdaps: LdapConfig = { ...ad, url: 'ldaps://127.0.0.1:10636', encryption: 'ldaps' }
export const adStartTls: LdapConfig = {
	...ad,
	url: 'ldap://127.0.0.1:10389',
	encryption: 'starttls',
}
/** Samba keeps "ldap server require strong auth = yes": a plain simple bind is refused (strongerAuthRequired). */
export const adPlain: LdapConfig = { ...ad, url: 'ldap://127.0.0.1:10389', encryption: 'none' }
export const openldapStartTls: LdapConfig = {
	...openldap,
	url: 'ldap://127.0.0.1:13890',
	encryption: 'starttls',
}
export const openldapPlain: LdapConfig = {
	...openldap,
	url: 'ldap://127.0.0.1:13890',
	encryption: 'none',
}

/** The seeded logins (sAMAccountName on smblds, uid on OpenLDAP): both directories use the same ones. */
const PEOPLE = {
	alice: 'alice',
	bob: 'bob',
	carol: 'carol',
	dave: 'dave',
	erin: 'erin',
	frank: 'frank',
} as const

/** The seeded groups' names (cn): both directories use the same ones. */
const GROUPS = {
	admins: 'hub-admins',
	engineering: 'hub-engineering',
	backend: 'hub-backend',
	rnd: 'R&D (Berlin), Team',
} as const

/** The three working modes of spec §8, with the seeded names each directory uses. */
export const TEST_DIRECTORIES = [
	{
		name: 'smblds over LDAPS',
		config: adLdaps,
		people: PEOPLE,
		groups: GROUPS,
		emailDomain: 'e2e.hub.test',
		/** A base the user filter matches nothing under: the `empty` safety stop (spec §6.4 step 2). */
		emptyBaseDn: 'CN=Computers,DC=e2e,DC=hub,DC=test',
	},
	{
		name: 'OpenLDAP over StartTLS',
		config: openldapStartTls,
		people: PEOPLE,
		groups: GROUPS,
		emailDomain: 'openldap.hub.test',
		emptyBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	},
	{
		name: 'OpenLDAP in plain',
		config: openldapPlain,
		people: PEOPLE,
		groups: GROUPS,
		emailDomain: 'openldap.hub.test',
		emptyBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	},
] as const

/** A bare ldapts client for the suite's own checks (not the hub's connection code); TLS for an ldaps:// URL. */
export const rawClient = (config: LdapConfig) =>
	new Client({
		url: config.url,
		connectTimeout: 5_000,
		timeout: 15_000,
		...(config.encryption === 'ldaps' ? { tlsOptions: { ca: [readFileSync(CA_FILE)] } } : {}),
	})
