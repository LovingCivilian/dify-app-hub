import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

/*
 * Spec §8: the hub's icons are the copy antd and Ant Design X use, so one major ships (antd's v5 → v6 migration guide:
 * "@ant-design/icons must be upgraded to v6"). Node's `createRequire` resolves a package as the named file's
 * directory would, so the same resolved path means the same installed copy (pnpm keeps one directory per version).
 */
const fromRoot = createRequire(import.meta.url)
const resolvedFrom = (pkg: string) =>
	createRequire(fromRoot.resolve(pkg)).resolve('@ant-design/icons')

describe('@ant-design/icons', () => {
	it('resolves to the copy antd uses', () => {
		expect(fromRoot.resolve('@ant-design/icons')).toBe(resolvedFrom('antd'))
	})

	it('resolves to the copy Ant Design X uses', () => {
		expect(fromRoot.resolve('@ant-design/icons')).toBe(resolvedFrom('@ant-design/x'))
	})
})
