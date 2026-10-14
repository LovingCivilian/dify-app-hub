import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * Part 1 spec §11: nothing neutral imports from lib/providers/dify except through the registry, the route guard or the
 * provider UI. The places that may: the provider modules themselves (lib/providers, whose registry and schemas map the
 * ids to Dify), the client registry and its provider sections (components/provider-ui), the Dify chat until Part 3
 * moves it onto the shared chat (components/chat), and the Dify routes (app/api/dify). Everything else is neutral.
 */
const ALLOWED = [
	/^lib\/providers\//,
	/^components\/provider-ui\//,
	/^components\/chat\//,
	/^app\/api\/dify\//,
]
const SOURCE = /\.(ts|tsx)$/
// Every module specifier in the forms TypeScript accepts: `from '…'` (import and re-export), the side-effect `import '…'`,
// the dynamic `import('…')` and `require('…')`, in single or double quotes (MDN "import", "Dynamic import").
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g
const DIFY_MODULE = /^(@\/lib\/providers\/dify|(\.\.?\/)+(lib\/)?(providers\/)?dify)(\/|$)/
// docs/frontend-conventions.md: neutral components never import `components/provider-ui/<id>/` (the Dify section, ...).
const PROVIDER_UI_DIRS = readdirSync('components/provider-ui', { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => entry.name)
const PROVIDER_UI_MODULE = new RegExp(
	`^(@\\/components\\/|(\\.\\.?\\/)+(components\\/)?)provider-ui\\/(${PROVIDER_UI_DIRS.join('|')})(\\/|$)`,
)

const specifiers = (source: string) => [...source.matchAll(SPECIFIER)].map(match => match[2]!)
const breaksBoundary = (file: string, source: string) =>
	specifiers(source).some(
		specifier =>
			(!ALLOWED.some(allowed => allowed.test(file)) && DIFY_MODULE.test(specifier)) ||
			(!file.startsWith('components/provider-ui/') && PROVIDER_UI_MODULE.test(specifier)),
	)

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return sources(full)
		return SOURCE.test(entry.name) ? [full.replaceAll('\\', '/')] : []
	})

describe('the provider boundary', () => {
	it('keeps every import of the Dify module inside the provider code', () => {
		const files = ['app', 'components', 'hooks', 'lib', 'db'].flatMap(sources)
		expect(files.length).toBeGreaterThan(100)
		const offenders = files.filter(file => breaksBoundary(file, readFileSync(file, 'utf8')))
		expect(offenders).toEqual([])
	})
})
