import { expect, type Locator, type Page, test, type TestInfo } from '@playwright/test'

import { aguiAgentUrl, STUB_AGUI_AUDIENCE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubPort } from './fixtures/env'

/*
 * Part 2 spec §2 and §12 (2a): an admin adds an AG-UI agent with Test connection (spec §2.4's mapping against the stub,
 * Task 13), and an edit keeps the write-only secret (ADR-0032). The drawer idioms are e2e/admin-apps.spec.ts's.
 */

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light']
/** An apps id (a UUID) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const CREATED = 'Created AG-UI agent'
const AGENT_URL = aguiAgentUrl(stubPort, 'assistant')
const SECRET = e2eEnv.E2E_AGUI_JWT_SECRET

/** The drawer's provider Select (E1): an antd Select's search box is its combobox, named by the field's label. */
const pickProvider = async (page: Page, drawer: Locator, name: string) => {
	await drawer.getByRole('combobox', { name: /^Provider/ }).click()
	await page.getByTitle(name, { exact: true }).click()
}
/** The Alert under Test connection (E7), found by its title. */
const testResult = (drawer: Locator, title: string) =>
	drawer.getByRole('alert').filter({ hasText: title })
const openDrawer = async (control: Locator, drawer: Locator) => {
	await expect(async () => {
		if (!(await drawer.isVisible())) await control.click()
		await expect(drawer).toBeVisible({ timeout: 2_000 })
	}).toPass()
}
// antd's Table sets data-row-key from rowKey on each body row.
const rowById = (page: Page, id: string) => page.locator(`tr[data-row-key="${id}"]`)
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop loading' })
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

const seedAguiApp = (id: string, name: string) =>
	withDb(db =>
		db.query(
			"INSERT INTO apps (id, provider, name, description, access_mode, settings, secrets) VALUES ($1, 'agui', $2, 'e2e', 'everyone', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets",
			[
				id,
				name,
				JSON.stringify({ agentUrl: AGENT_URL, audience: STUB_AGUI_AUDIENCE }),
				JSON.stringify({ jwtSecret: SECRET }),
			],
		),
	)
const dropApp = (id: string) => withDb(db => db.query('DELETE FROM apps WHERE id = $1', [id]))

test.describe('AG-UI apps in the admin', () => {
	// One project runs at a time, so the created app is removed by name after each test.
	test.afterEach(async () => {
		await withDb(db => db.query('DELETE FROM apps WHERE name = $1', [CREATED]))
	})

	test('an admin adds an AG-UI agent: its fields, Test connection’s answers, and the save', async ({
		page,
	}) => {
		await page.goto('/app-management')
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await pickProvider(page, create, 'AG-UI agent')
		await create.getByLabel('App name').fill(CREATED)
		await create.getByLabel('Agent URL').fill(AGENT_URL)
		await create.getByLabel('Audience').fill(STUB_AGUI_AUDIENCE)
		await create.getByLabel('JWT secret').fill(SECRET)
		const testButton = create.getByRole('button', { name: 'Test connection' })

		// Spec §2.4: the stub refuses `{}` with 422 after the token passed: reachable.
		await testButton.click()
		await expect(testResult(create, 'Connected')).toBeVisible()

		// Another secret of the allowed length: the stub's 401.
		await create.getByLabel('JWT secret').fill('a-different-secret-of-forty-characters-00')
		// A connection field changed: the old result is gone (E7).
		await expect(testResult(create, 'Connected')).toHaveCount(0)
		await testButton.click()
		await expect(testResult(create, 'The key was refused')).toBeVisible()

		await create.getByLabel('JWT secret').fill(SECRET)
		await create.getByLabel('Agent URL').fill(aguiAgentUrl(stubPort, 'missing'))
		await testButton.click()
		await expect(testResult(create, 'The agent was not found')).toBeVisible()

		// The stub drops the socket on this path (Part 1's unreachable scenario).
		await create.getByLabel('Agent URL').fill(`http://127.0.0.1:${stubPort}/v1/unreachable`)
		await testButton.click()
		await expect(testResult(create, 'The provider could not be reached')).toBeVisible()

		await create.getByLabel('Agent URL').fill(AGENT_URL)
		await create.getByRole('button', { name: 'OK' }).click()
		await expect(page.getByText('App configuration added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(CREATED) })
		await expect(row.getByText('AG-UI agent', { exact: true })).toBeVisible()
		// E11: no image, so AG-UI's fallback icon (antd icons are role="img", named after the icon).
		await expect(row.getByRole('img', { name: 'robot' })).toBeVisible()
		// Secrets are write-only (spec §2.2): stored, never echoed.
		const stored = await withDb(async db => {
			const { rows } = await db.query<{ secrets: { jwtSecret: string } }>(
				'SELECT secrets FROM apps WHERE name = $1',
				[CREATED],
			)
			return rows[0]?.secrets
		})
		expect(stored).toEqual({ jwtSecret: SECRET })
	})

	test('an edit keeps a blank secret, and the chat still signs with it', async ({
		page,
	}, testInfo) => {
		const id = ownId(400, testInfo)
		await seedAguiApp(id, `AG-UI edit ${testInfo.project.name}`)
		try {
			await page.goto('/app-management')
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			await expect(edit.getByLabel('Agent URL')).toHaveValue(AGENT_URL)
			// The stored secret never comes back to the browser: a blank field keeps it (ADR-0032).
			await expect(edit.getByLabel('JWT secret')).toHaveValue('')
			await expect(edit.getByLabel('JWT secret')).toHaveAttribute(
				'placeholder',
				'Leave blank to keep',
			)
			await edit.getByLabel('App description').fill('Edited by the e2e suite')
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(edit).toBeHidden()
			await expect(rowById(page, id).getByText('Edited by the e2e suite')).toBeVisible()
			const stored = await withDb(async db => {
				const { rows } = await db.query<{ secrets: { jwtSecret: string } }>(
					'SELECT secrets FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.secrets
			})
			expect(stored).toEqual({ jwtSecret: SECRET })

			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('hello after the edit')
			await page.keyboard.press('Enter')
			await expect(
				page.locator('.ant-bubble-start').last().locator('strong', { hasText: 'stub agent' }),
			).toBeVisible()
			// The run settles before the app goes, or its last write meets the deleted app (an FK violation in the server log).
			await expect(stopButton(page)).toHaveCount(0)
		} finally {
			await dropApp(id)
		}
	})

	// Part 2 spec §6.2 and plan calls P1 and P16: the switch is off by default, saves into the settings, and the next run
	// advertises ask_user only while it is on (the stub asks only when `tools` names it, Task 16).
	test('the Ask the user switch saves, and the chat offers ask_user only while it is on', async ({
		page,
	}, testInfo) => {
		const id = ownId(410, testInfo)
		await seedAguiApp(id, `AG-UI ask ${testInfo.project.name}`)
		try {
			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('question')
			await page.keyboard.press('Enter')
			await expect(
				page
					.locator('.ant-bubble-start')
					.last()
					.getByText('No ask_user tool was offered, so I cannot ask you.'),
			).toBeVisible()

			await page.goto('/app-management')
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			// antd Switch is a button with role="switch" and aria-checked, named by its Form.Item label.
			const askUser = edit.getByRole('switch', { name: 'Ask the user' })
			await expect(askUser).not.toBeChecked()
			await askUser.click()
			await expect(askUser).toBeChecked()
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(edit).toBeHidden()
			const settings = await withDb(async db => {
				const { rows } = await db.query<{ settings: Record<string, unknown> }>(
					'SELECT settings FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.settings
			})
			expect(settings).toMatchObject({ askUser: true })

			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('question')
			await page.keyboard.press('Enter')
			await expect(page.getByRole('group', { name: 'Question 1 of 2' })).toBeVisible()
			await expect(stopButton(page)).toHaveCount(0)
		} finally {
			await dropApp(id)
		}
	})
})
