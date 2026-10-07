import { expect, test, type Locator, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'
import type { SampleName } from './fixtures/markdown-samples'

// The Markdown spike's criteria 2–8 (spec §6), kept on the real chat bubble: the stub streams a sample of
// e2e/fixtures/markdown-samples.ts for the query `md:<name>` (40-character `message` chunks).

/** 120×60 PNG for the samples' `/files/stub-image.png`, which resolves against the app's origin (test-only route). */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAhUlEQVR4nO3QAQkAIADAMFNY1fjaQuEOHuBszLV1ofH84JNAg24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVgcM2YQGU1Zk5AAAAABJRU5ErkJggg==',
	'base64',
)

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** Assistant bubbles (placement start), oldest first. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
/** X Sender's stop control, named by X's locale: present only while a reply streams. */
const stopControl = (page: Page) => page.getByRole('button', { name: 'Stop loading' })

/** Sends `md:<name>`; the stub answers with that sample. */
async function sendSample(page: Page, name: SampleName) {
	await senderBox(page).fill(`md:${name}`)
	await page.keyboard.press('Enter')
}

/** Waits until the reply that shows `done` has ended, so the next send is not ignored. */
async function replyEnded(page: Page, done: Locator) {
	await expect(done).toBeVisible()
	await expect(stopControl(page)).toHaveCount(0)
}

/** Records the message list's text after every DOM mutation, so states shorter than a polling interval are seen. */
const recordListText = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as { __texts: string[] }
		w.__texts = []
		new MutationObserver(() => {
			const list = document.querySelector<HTMLElement>('.ant-bubble-list')
			if (list) w.__texts.push(list.innerText)
		}).observe(document.body, { subtree: true, childList: true, characterData: true })
	})

const recordedListText = (page: Page) =>
	page.evaluate(() => (window as unknown as { __texts: string[] }).__texts)

test.describe('Markdown in the chat bubble', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		await page.route('**/files/stub-image.png', route =>
			route.fulfill({ body: PNG, contentType: 'image/png' }),
		)
		await page.route('https://example.com/**', route => route.fulfill({ status: 204 }))
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await expect(senderBox(page)).toBeVisible()
		if (testInfo.project.use.colorScheme === 'dark')
			await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
	})

	test('2 fenced code: highlighter, mermaid, echarts and svg each render', async ({ page }) => {
		// X's Mermaid draws the first diagram on a page blank under React Strict Mode (dev only), so the
		// sample is sent twice and the second bubble is the one checked.
		await sendSample(page, 'code')
		await replyEnded(page, answers(page).first().locator('svg rect[width="80"]'))
		await sendSample(page, 'code')
		await expect(answers(page)).toHaveCount(2)
		const answer = answers(page).nth(1)
		const highlighter = answer.locator('.ant-codeHighlighter')
		await expect(highlighter).toHaveCount(1)
		await expect(highlighter.getByText('rows.reduce')).toBeVisible()
		await expect(highlighter.locator('.ant-codeHighlighter-header')).toContainText('ts')
		await expect(
			highlighter.locator('.ant-codeHighlighter-header').getByRole('button'),
		).toHaveCount(1)
		await expect(
			answer.locator('.ant-mermaid svg[id^="mermaid"]').getByText('Retrieve'),
		).toBeVisible()
		await expect(answer.locator('.echarts-for-react canvas').first()).toBeVisible()
		await expect(answer.locator('svg rect[width="80"]')).toBeVisible()
		// Inline code stays inline, outside the highlighter.
		await expect(answer.locator('code').filter({ hasText: 'pnpm add antd' })).toBeVisible()
		await expect(highlighter.locator('code').filter({ hasText: 'pnpm add antd' })).toHaveCount(0)
		// Wide code scrolls inside its block; the page itself never scrolls sideways (mobile).
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			),
		).toBeLessThanOrEqual(0)
	})

	test('3 math: inline and block formulas render through the Latex plugin', async ({ page }) => {
		await sendSample(page, 'math')
		const answer = answers(page).last()
		await expect(answer.locator('.katex').first()).toBeVisible()
		await expect(answer.locator('.katex')).toHaveCount(4)
		await expect(answer.locator('li .katex')).toHaveCount(2)
		await expect(answer.locator('.katex-error')).toHaveCount(0)
		await expect(answer.locator('.x-markdown')).not.toContainText('$$')
		await expect(answer.locator('.x-markdown')).not.toContainText('\\[')
	})

	test('4 think: open while streaming, closed with the elapsed time, which a reload keeps', async ({
		page,
	}) => {
		const reasoning = 'The user asks for a summary'
		await recordListText(page)
		await sendSample(page, 'think')
		const answer = answers(page).last()
		await replyEnded(page, answer.getByText('Here is the short summary you asked for.'))
		const label = answer.getByText(/^Finished thinking \(\d+\.\ds\)$/)
		await expect(label).toBeVisible()
		await expect(answer.getByText(reasoning)).toHaveCount(0)
		const texts = await recordedListText(page)
		expect(
			texts.some(text => /Thinking\.\.\. \(\d+\.\ds\)/.test(text) && text.includes(reasoning)),
		).toBe(true)
		const finished = await label.innerText()
		await label.click()
		await expect(answer.getByText(reasoning)).toBeVisible()
		// Reopened from Dify (workers: 1: the chat app's latest conversation is this one): the time is
		// stored under the Dify message id, which the history carries too.
		await page.goto(`/chat/${APP_ID}`)
		await expect(answers(page).last().getByText(finished, { exact: true })).toBeVisible()
	})

	test('5 html: img, video, form, button and details survive sanitising and post back', async ({
		page,
	}) => {
		await sendSample(page, 'html')
		const answer = answers(page).first()
		await replyEnded(page, answer.locator('details summary'))
		await expect(answer.locator('details summary')).toHaveText('Raw data')
		const image = answer.getByRole('img', { name: 'chart' })
		await expect(image).toBeVisible()
		await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120)
		// Both forms of <video> Dify writes play: a `src` attribute, and <source> children (VideoBlock).
		const videos = answer.locator('video')
		await expect(videos).toHaveCount(2)
		await expect(videos.first()).toHaveAttribute('controls', '')
		await expect(videos.first()).toHaveAttribute('src', 'https://example.com/clip.mp4')
		await expect(videos.nth(1)).toHaveAttribute('controls', '')
		await expect(videos.nth(1).locator('source')).toHaveAttribute(
			'src',
			'https://example.com/clip.webm',
		)
		// <button data-message> posts its text back as the next message.
		await answer.getByRole('button', { name: 'Tell me more' }).click()
		await replyEnded(page, page.getByText('Echo: Tell me more', { exact: true }))
		// <form data-format="json"> posts its values back as JSON.
		await answer.getByLabel('Name').fill('Jane')
		await answer.getByRole('button', { name: 'Send details' }).click()
		const sent = page.locator('.ant-bubble-end').last()
		await expect(sent).toContainText('"name":"Jane"')
		await expect(sent).toContainText('"isFormSubmit":true')
	})

	test('6 image first: content starting with an image renders it with preview', async ({
		page,
	}) => {
		await sendSample(page, 'imageFirst')
		const answer = answers(page).last()
		const image = answer.getByRole('img', { name: 'leading image' })
		await expect(image).toBeVisible()
		await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(120)
		await expect(answer.getByText('Text after the image.')).toBeVisible()
		await image.click()
		await expect(page.locator('.ant-image-preview')).toBeVisible()
	})

	test('7 links open in a new tab', async ({ page }) => {
		await sendSample(page, 'links')
		const answer = answers(page).last()
		for (const name of ['Ant Design', 'https://x.ant.design']) {
			const link = answer.getByRole('link', { name })
			await expect(link).toHaveAttribute('target', '_blank')
			await expect(link).toHaveAttribute('rel', /noopener/)
		}
	})

	test('8 theme: the root follows the colour scheme; tables and code follow it too', async ({
		page,
	}, testInfo) => {
		const dark = testInfo.project.use.colorScheme === 'dark'
		await sendSample(page, 'theme')
		const answer = answers(page).last()
		await expect(answer.locator('.x-markdown')).toHaveClass(
			dark ? /x-markdown-dark/ : /x-markdown-light/,
		)
		await expect(answer.locator('.x-markdown')).not.toHaveClass(
			dark ? /x-markdown-light/ : /x-markdown-dark/,
		)
		await expect(answer.locator('.ant-codeHighlighter')).toBeVisible()
		// Relative luminance and contrast (WCAG 2) of an element's text against the first opaque background.
		const measure = (selector: string) =>
			answer
				.locator(selector)
				.first()
				.evaluate(el => {
					const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
					const luminance = ([r, g, b]: number[]) => {
						const c = [r, g, b].map(v => {
							const x = v / 255
							return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
						})
						return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
					}
					let node: Element | null = el
					let background = [255, 255, 255]
					while (node) {
						const parts = rgb(getComputedStyle(node).backgroundColor)
						if (parts.length >= 3 && (parts.length === 3 || parts[3] > 0.5)) {
							background = parts.slice(0, 3)
							break
						}
						node = node.parentElement
					}
					const text = luminance(rgb(getComputedStyle(el).color))
					const bg = luminance(background)
					return { bg, contrast: (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05) }
				})
		const results = {
			td: await measure('td'),
			th: await measure('th'),
			code: await measure('.ant-codeHighlighter-code code'),
		}
		for (const [part, { bg, contrast }] of Object.entries(results)) {
			expect(dark ? bg < 0.2 : bg > 0.6, `${part} background follows the scheme`).toBe(true)
			expect(contrast, `${part} text contrast`).toBeGreaterThanOrEqual(4.5)
		}
	})
})
