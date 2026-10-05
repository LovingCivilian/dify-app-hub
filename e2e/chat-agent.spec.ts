import { expect, test, type Page } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

/** The Sender's box by its placeholder: the agent app's "Topic" field above it is a textbox too. */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

// The stub's agent default scenario: two agent_thought events (the second calls `web_search`), the answer
// as agent_message chunks, then message_end.
test('an agent reply shows its tool call as a thought chain and the answer below', async ({
	page,
}, testInfo) => {
	const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
	const text = `hello agent ${run}`
	await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
	// The agent app requires a topic before anything can be sent.
	await page.getByLabel('Topic').fill(`tea ${run}`)
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
	// Only the thought that called a tool is a step; the plain thought is not shown.
	const step = page.getByText('Used web_search', { exact: true })
	await expect(step).toBeVisible()
	await expect(page.getByText('I should look this up.')).toHaveCount(0)
	// Collapsed until opened: the tool's input and observation are its content.
	await expect(page.getByText('{"results":["one","two"]}', { exact: true })).toHaveCount(0)
	await step.click()
	await expect(page.getByText('{"q":"hello"}', { exact: true })).toBeVisible()
	await expect(page.getByText('{"results":["one","two"]}', { exact: true })).toBeVisible()
})
