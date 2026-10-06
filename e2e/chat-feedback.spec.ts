import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

import { APP_ID, APP_IDS } from './fixtures/constants'

/** The Sender's box by its placeholder: an app's parameter fields above it are textboxes too. */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The newest assistant bubble (placement start). */
const lastAnswer = (page: Page) => page.locator('.ant-bubble-start').last()
/** Texts unique per project, repeat and retry: the stub keeps every conversation for the whole run. */
const runOf = (testInfo: TestInfo) =>
	`${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`

/** The rating buttons, named through message.like / message.dislike (exact: "Like" is part of "Dislike"). */
const likeButton = (scope: Locator) => scope.getByRole('button', { name: 'Like', exact: true })
const dislikeButton = (scope: Locator) =>
	scope.getByRole('button', { name: 'Dislike', exact: true })

/**
 * The answer to POST /messages/<id>/feedbacks through the app's proxy: waited for before anything that
 * leaves the page (a reload would abort a request still on its way, e.g. while `next dev` compiles the route).
 */
const feedbackAnswered = (page: Page) =>
	page.waitForResponse(
		response =>
			response.request().method() === 'POST' &&
			/\/messages\/[^/]+\/feedbacks$/.test(new URL(response.url()).pathname),
	)

/**
 * An antd token's colour as the browser computes it under the page's theme: antd 6 publishes its tokens
 * as --ant-* variables on <App>'s root, so a probe styled with the variable resolves it to rgb().
 */
const tokenColor = (page: Page, variable: string) =>
	page
		.locator('.ant-app')
		.first()
		.evaluate((root, name) => {
			const probe = document.createElement('span')
			probe.style.color = `var(${name})`
			root.append(probe)
			const color = getComputedStyle(probe).color
			probe.remove()
			return color
		}, variable)

async function send(page: Page, text: string) {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	await expect(lastAnswer(page).getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
}

test.describe('message feedback', () => {
	// Each test starts on a new conversation of the chat app; a reload reopens the latest one, which is the
	// test's own (`workers: 1` in playwright.config.ts).
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await expect(senderBox(page)).toBeVisible()
	})

	test('a like turns colorSuccess, reaches Dify and survives a reload', async ({
		page,
	}, testInfo) => {
		const text = `rate me ${runOf(testInfo)}`
		await send(page, text)
		const like = likeButton(lastAnswer(page))
		const dislike = dislikeButton(lastAnswer(page))
		// The theme has settled by now (the page answered a message), so the tokens are the scheme's own.
		const neutral = await tokenColor(page, '--ant-color-text')
		const success = await tokenColor(page, '--ant-color-success')
		await expect(like).toHaveAttribute('aria-pressed', 'false')
		await expect(like).toHaveCSS('color', neutral)
		await expect(dislike).toHaveCSS('color', neutral)
		const answered = feedbackAnswered(page)
		await like.click()
		const liked = await answered
		expect(liked.request().postDataJSON()).toMatchObject({ rating: 'like' })
		expect(liked.ok()).toBe(true)
		await expect(like).toHaveAttribute('aria-pressed', 'true')
		await expect(like).toHaveCSS('color', success)
		await expect(dislike).toHaveAttribute('aria-pressed', 'false')
		await expect(dislike).toHaveCSS('color', neutral)
		// The stub keeps the rating on the message it knows by its Dify id (an unknown id answers 404 and the
		// like would roll back): the reopened history shows it.
		await page.goto(`/chat/${APP_ID}`)
		await expect(lastAnswer(page).getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		await expect(like).toHaveAttribute('aria-pressed', 'true')
		await expect(like).toHaveCSS('color', success)
	})

	test('a dislike asks for a reason, sends it, turns colorError and can be taken back', async ({
		page,
	}, testInfo) => {
		await send(page, `judge me ${runOf(testInfo)}`)
		const like = likeButton(lastAnswer(page))
		const dislike = dislikeButton(lastAnswer(page))
		const neutral = await tokenColor(page, '--ant-color-text')
		const error = await tokenColor(page, '--ant-color-error')
		const reason = page.getByRole('textbox', { name: 'What was wrong? (optional)' })
		// Cancelling sends nothing and leaves the answer unrated.
		await dislike.click()
		await expect(reason).toBeFocused()
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(reason).toBeHidden()
		await expect(dislike).toHaveAttribute('aria-pressed', 'false')
		await expect(dislike).toHaveCSS('color', neutral)
		// With a reason; the box is focused again on the second opening.
		await dislike.click()
		await expect(reason).toBeFocused()
		await reason.fill('Too short')
		const answered = feedbackAnswered(page)
		await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
		expect((await answered).request().postDataJSON()).toMatchObject({
			rating: 'dislike',
			content: 'Too short',
		})
		await expect(reason).toBeHidden()
		await expect(dislike).toHaveAttribute('aria-pressed', 'true')
		await expect(dislike).toHaveCSS('color', error)
		await expect(like).toHaveCSS('color', neutral)
		// Clicking the chosen dislike again withdraws the rating (Dify: rating null).
		const withdrawn = feedbackAnswered(page)
		await dislike.click()
		expect((await withdrawn).request().postDataJSON()).toMatchObject({ rating: null })
		await expect(dislike).toHaveAttribute('aria-pressed', 'false')
		await expect(dislike).toHaveCSS('color', neutral)
		await expect(like).toHaveCSS('color', neutral)
	})

	// ADR-0014: every control is reachable by keyboard.
	test('the rating buttons work from the keyboard', async ({ page }, testInfo) => {
		await send(page, `keys ${runOf(testInfo)}`)
		const like = likeButton(lastAnswer(page))
		const dislike = dislikeButton(lastAnswer(page))
		// The chat app's footer: regenerate, copy, like, dislike.
		await lastAnswer(page).getByRole('button', { name: 'Copy' }).focus()
		await page.keyboard.press('Tab')
		await expect(like).toBeFocused()
		const liked = feedbackAnswered(page)
		await page.keyboard.press('Enter')
		expect((await liked).request().postDataJSON()).toMatchObject({ rating: 'like' })
		await expect(like).toHaveAttribute('aria-pressed', 'true')
		// The dislike opens its reason box with the focus in it; Tab reaches Cancel, then Send.
		await page.keyboard.press('Tab')
		await expect(dislike).toBeFocused()
		await page.keyboard.press('Enter')
		const reason = page.getByRole('textbox', { name: 'What was wrong? (optional)' })
		await expect(reason).toBeFocused()
		await expect(lastAnswer(page)).toBeInViewport()
		await page.keyboard.type('Wrong topic')
		await page.keyboard.press('Tab')
		await page.keyboard.press('Tab')
		await expect(page.getByRole('button', { name: 'Send feedback', exact: true })).toBeFocused()
		const disliked = feedbackAnswered(page)
		await page.keyboard.press('Enter')
		expect((await disliked).request().postDataJSON()).toMatchObject({
			rating: 'dislike',
			content: 'Wrong topic',
		})
		await expect(dislike).toHaveAttribute('aria-pressed', 'true')
		await expect(like).toHaveAttribute('aria-pressed', 'false')
	})

	test('no actions show while a reply streams, and earlier answers cannot be regenerated meanwhile', async ({
		page,
	}, testInfo) => {
		const run = runOf(testInfo)
		await send(page, `before ${run}`)
		const regenerateEarlier = page
			.locator('.ant-bubble-start')
			.filter({ hasText: `Echo: before ${run}` })
			.getByRole('button', { name: 'Regenerate response' })
		await expect(regenerateEarlier).toBeEnabled()
		// The stub's `slow` stream: 40 chunks at 100 ms.
		await senderBox(page).fill(`slow ${run}`)
		await page.keyboard.press('Enter')
		await expect(lastAnswer(page)).toContainText('0 1 2')
		await expect(lastAnswer(page).locator('.ant-actions')).toHaveCount(0)
		await expect(regenerateEarlier).toBeDisabled()
		await expect(
			likeButton(page.locator('.ant-bubble-start').filter({ hasText: `Echo: before ${run}` })),
		).toBeDisabled()
		// Once it has finished, its own actions appear and the earlier ones are usable again.
		await expect(lastAnswer(page)).toContainText('37 38 39')
		await expect(likeButton(lastAnswer(page))).toBeEnabled()
		await expect(regenerateEarlier).toBeEnabled()
	})

	test('an answer that failed offers no feedback', async ({ page }, testInfo) => {
		// The stub's `error` scenario: "Echo: " and then an `error` event (the message keeps its Dify id).
		await senderBox(page).fill(`cause an error ${runOf(testInfo)}`)
		await page.keyboard.press('Enter')
		await expect(lastAnswer(page).getByRole('alert')).toContainText('The model is unavailable.')
		// The footer is there (regenerate retries the question), without the rating buttons.
		await expect(
			lastAnswer(page).getByRole('button', { name: 'Regenerate response' }),
		).toBeVisible()
		await expect(likeButton(lastAnswer(page))).toHaveCount(0)
		await expect(dislikeButton(lastAnswer(page))).toHaveCount(0)
	})
})

// The stub's chatflow app enables text_to_speech (its /parameters) and annotation (seeded in auth.setup.ts);
// the chat app enables neither.
test.describe('text to speech and annotation', () => {
	test('read aloud plays the answer, stop reading ends it, and it ends by itself', async ({
		page,
	}, testInfo) => {
		const text = `read this ${runOf(testInfo)}`
		await page.goto(`/chat/${APP_IDS['advanced-chat']}?isNewCvst=1`)
		await send(page, text)
		// Named "Read aloud" while idle and "Stop reading" while the clip plays, pressed meanwhile.
		const read = lastAnswer(page).getByRole('button', { name: 'Read aloud', exact: true })
		const stop = lastAnswer(page).getByRole('button', { name: 'Stop reading', exact: true })
		await expect(read).toHaveAttribute('aria-pressed', 'false')
		const requested = page.waitForRequest(
			request =>
				request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/text2audio'),
		)
		await read.click()
		expect((await requested).postDataJSON()).toMatchObject({ text: `Echo: ${text}` })
		// Actions.Audio's status classes: loading → running while the clip (the stub's 3 s WAV) plays.
		await expect(stop).toHaveClass(/ant-actions-audio-running/)
		await expect(stop).toHaveAttribute('aria-pressed', 'true')
		await stop.click()
		await expect(read).toHaveClass(/ant-actions-audio-default/)
		await expect(read).toHaveAttribute('aria-pressed', 'false')
		// Played to its end, it returns to the idle state by itself.
		await read.click()
		await expect(stop).toHaveClass(/ant-actions-audio-running/)
		await expect(read).toHaveClass(/ant-actions-audio-default/)
	})

	test('annotation opens a drawer with the question and the answer and saves them', async ({
		page,
	}, testInfo) => {
		const text = `annotate me ${runOf(testInfo)}`
		await page.goto(`/chat/${APP_IDS['advanced-chat']}?isNewCvst=1`)
		await send(page, text)
		await lastAnswer(page).getByRole('button', { name: 'Annotation', exact: true }).click()
		const drawer = page.getByRole('dialog', { name: 'Create annotation' })
		await expect(drawer.getByRole('textbox', { name: 'Question' })).toHaveValue(text)
		await expect(drawer.getByRole('textbox', { name: 'Answer' })).toHaveValue(`Echo: ${text}`)
		await drawer.getByRole('textbox', { name: 'Answer' }).fill('A better answer')
		const saved = page.waitForRequest(
			request =>
				request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/annotations'),
		)
		await drawer.getByRole('button', { name: 'Confirm', exact: true }).click()
		expect((await saved).postDataJSON()).toMatchObject({
			question: text,
			answer: 'A better answer',
		})
		await expect(page.getByText('Annotation saved', { exact: true })).toBeVisible()
		await expect(drawer).toBeHidden()
	})

	test('an app without them offers neither', async ({ page }, testInfo) => {
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await send(page, `plain ${runOf(testInfo)}`)
		await expect(
			lastAnswer(page).getByRole('button', { name: 'Regenerate response' }),
		).toBeVisible()
		await expect(lastAnswer(page).getByRole('button', { name: 'Read aloud' })).toHaveCount(0)
		await expect(lastAnswer(page).getByRole('button', { name: 'Annotation' })).toHaveCount(0)
	})
})
