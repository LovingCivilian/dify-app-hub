export type StubMode = 'chat' | 'agent-chat' | 'advanced-chat' | 'workflow' | 'completion'
export type StubPrefix = '' | '/agent' | '/chatflow' | '/workflow' | '/completion'

export interface StubApp {
	id: string
	name: string
	mode: StubMode
	prefix: StubPrefix
}

/** The five seeded apps. The first keeps the foundation's id and name so older specs keep their locators. */
export const STUB_APPS: StubApp[] = [
	{ id: 'e2e00000-0000-4000-8000-000000000001', name: 'Stub app', mode: 'chat', prefix: '' },
	{
		id: 'e2e00000-0000-4000-8000-000000000002',
		name: 'Stub agent',
		mode: 'agent-chat',
		prefix: '/agent',
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000003',
		name: 'Stub chatflow',
		mode: 'advanced-chat',
		prefix: '/chatflow',
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000004',
		name: 'Stub workflow',
		mode: 'workflow',
		prefix: '/workflow',
	},
	{
		id: 'e2e00000-0000-4000-8000-000000000005',
		name: 'Stub completion',
		mode: 'completion',
		prefix: '/completion',
	},
]

export const APP_IDS = Object.fromEntries(STUB_APPS.map(app => [app.mode, app.id])) as Record<
	StubMode,
	string
>

/** `/v1/<prefix>/<dify path>` → the app mode and the Dify path. Unprefixed `/v1/...` is the chat app. */
export const modeFromPath = (pathname: string): { mode: StubMode; path: string } => {
	const stripped = pathname.replace(/^\/v1/, '')
	for (const app of STUB_APPS) {
		if (app.prefix && (stripped === app.prefix || stripped.startsWith(`${app.prefix}/`))) {
			return { mode: app.mode, path: stripped.slice(app.prefix.length) || '/' }
		}
	}
	return { mode: 'chat', path: stripped || '/' }
}
