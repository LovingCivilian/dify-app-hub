export type StubMode = 'chat' | 'agent-chat' | 'advanced-chat' | 'workflow' | 'completion'
export type StubPrefix =
	| ''
	| '/agent'
	| '/chatflow'
	| '/workflow'
	| '/completion'
	| '/disabled'
	| '/nosite'
	| '/created'

export interface StubApp {
	id: string
	name: string
	mode: StubMode
	prefix: StubPrefix
	/** Seeded into `dify_apps.opening_statement_display_mode`: 'always' keeps the welcome panel after the first reply. */
	openingStatementDisplayMode: 'default' | 'always'
	/** Seeded into `dify_apps.enable_annotation` (the app's `extConfig.annotation.enabled`): the footer offers "Annotation". */
	enableAnnotation: boolean
	/** GET /site: an emoji icon (default), an image icon, or Dify's 403 for an app without a site. */
	site?: 'emoji' | 'image' | 'none'
	/** Seeded into `dify_apps.is_enabled` (1 enabled, 2 disabled); 1 when absent. */
	isEnabled?: 1 | 2
}

/** The five seeded apps. The first keeps the foundation's id and name so older specs keep their locators. */
export const STUB_APPS: StubApp[] = [
	{
		id: 'e2e00000-0000-4000-8000-000000000001',
		name: 'Stub app',
		mode: 'chat',
		prefix: '',
		openingStatementDisplayMode: 'default',
		enableAnnotation: false,
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000002',
		name: 'Stub agent',
		mode: 'agent-chat',
		prefix: '/agent',
		openingStatementDisplayMode: 'default',
		enableAnnotation: false,
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000003',
		name: 'Stub chatflow',
		mode: 'advanced-chat',
		prefix: '/chatflow',
		openingStatementDisplayMode: 'always',
		enableAnnotation: true,
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000004',
		name: 'Stub workflow',
		mode: 'workflow',
		prefix: '/workflow',
		openingStatementDisplayMode: 'default',
		enableAnnotation: false,
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000005',
		name: 'Stub completion',
		mode: 'completion',
		prefix: '/completion',
		openingStatementDisplayMode: 'default',
		enableAnnotation: false,
	},
]

export const APP_IDS = Object.fromEntries(STUB_APPS.map(app => [app.mode, app.id])) as Record<
	StubMode,
	string
>

/**
 * Sub-project 3 fixtures, kept out of STUB_APPS so APP_IDS keeps one id per mode for the chat specs.
 * The disabled and no-site apps are seeded by e2e/auth.setup.ts; the created app is not — the admin
 * spec creates it through the form, and its /info answers a name of its own and its /site an image icon.
 */
export const DISABLED_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000006',
	name: 'Stub disabled',
	mode: 'chat',
	prefix: '/disabled',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	isEnabled: 2,
}
export const NO_SITE_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000007',
	name: 'Stub no-site',
	mode: 'workflow',
	prefix: '/nosite',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	site: 'none',
}
export const CREATED_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000008',
	name: 'Created app',
	mode: 'chat',
	prefix: '/created',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	site: 'image',
}
export const SEEDED_EXTRA_APPS: StubApp[] = [DISABLED_APP, NO_SITE_APP]
const ALL_STUB_APPS = [...STUB_APPS, ...SEEDED_EXTRA_APPS, CREATED_APP]

const matchPrefix = (pathname: string): { app: StubApp; path: string } => {
	const stripped = pathname.replace(/^\/v1/, '')
	for (const app of ALL_STUB_APPS) {
		if (app.prefix && (stripped === app.prefix || stripped.startsWith(`${app.prefix}/`))) {
			return { app, path: stripped.slice(app.prefix.length) || '/' }
		}
	}
	return { app: STUB_APPS[0], path: stripped || '/' }
}

/** `/v1/<prefix>/<dify path>` → the app mode and the Dify path. Unprefixed `/v1/...` is the chat app. */
export const modeFromPath = (pathname: string): { mode: StubMode; path: string } => {
	const { app, path } = matchPrefix(pathname)
	return { mode: app.mode, path }
}

/** The app a stub path belongs to (its name, site variant and annotation store). */
export const appFromPath = (pathname: string): StubApp => matchPrefix(pathname).app
