import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_OPEN_KEYS, adminNavItems, selectedAdminKey } from '@/components/shell/admin-nav'

describe('the admin navigation (settings spec §5.1)', () => {
	it('has two groups with their pages as children, and the children carry no icons', () => {
		const items = adminNavItems(key => key)
		expect(items.map(item => item && 'key' in item && item.key)).toEqual(['management', 'settings'])
		const children = items.map(item => (item && 'children' in item ? (item.children ?? []) : []))
		expect(children.map(group => group.map(child => child && 'key' in child && child.key))).toEqual(
			[['/app-management', '/user-management', '/group-management'], ['/settings/branding']],
		)
		for (const group of children)
			for (const child of group) expect(child && 'icon' in child && child.icon).toBeFalsy()
	})

	it('opens both groups by default', () => {
		expect(ADMIN_NAV_OPEN_KEYS).toEqual(['management', 'settings'])
	})

	it('selects the page under the pathname, at a segment boundary', () => {
		expect(selectedAdminKey('/user-management')).toBe('/user-management')
		expect(selectedAdminKey('/settings/branding')).toBe('/settings/branding')
		expect(selectedAdminKey('/group-management/anything')).toBe('/group-management')
		expect(selectedAdminKey('/user-managementx')).toBeUndefined()
		expect(selectedAdminKey('/settings')).toBeUndefined()
	})
})
