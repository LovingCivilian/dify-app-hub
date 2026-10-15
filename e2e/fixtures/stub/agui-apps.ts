/**
 * The AG-UI apps the e2e seed adds (Part 2 spec §10; plan call P14): one whose agent answers, and one whose agent the
 * stub does not know (404 before any stream: agent_not_found). Pure constants, so the specs import them without the
 * stub's server code.
 */
export interface StubAguiApp {
	id: string
	name: string
	/** The last path segment of the agent URL, as the owner's service names agents (`<base>/agents/<name>`). */
	agent: string
	/** The app's `askUser` switch (Part 2 spec §6.2; plan call P18): while it is on, its runs advertise ask_user. */
	askUser: boolean
}

export const AGUI_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a1',
	name: 'Stub AG-UI agent',
	agent: 'assistant',
	askUser: true,
}

export const AGUI_MISSING_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a2',
	name: 'Stub AG-UI missing',
	agent: 'missing',
	askUser: false,
}

export const STUB_AGUI_APPS: StubAguiApp[] = [AGUI_APP, AGUI_MISSING_APP]

/** The one agent the stub serves; any other name answers 404. */
export const STUB_AGUI_AGENT = 'assistant'

/** The JWT audience the stub checks (the owner's AGENT_JWT_AUDIENCE) and the seeded apps' `audience`. */
export const STUB_AGUI_AUDIENCE = 'assistant'

/** An agent's URL on the stub server. */
export const aguiAgentUrl = (port: number, agent: string) =>
	`http://127.0.0.1:${port}/agui/agents/${agent}`
