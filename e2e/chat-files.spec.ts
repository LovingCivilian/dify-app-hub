import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { APP_ID, APP_IDS } from './fixtures/constants'

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

// The stub's `files` scenario (any chat-like app) streams the answer and a `message_file` image that the
// assistant produced; the stub serves the PNG itself.
test('an image the assistant produced renders with a preview', async ({ page }, testInfo) => {
	const text = `send files please ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
	// The stream names no file, so the image is described by the generic text.
	const files = page.getByRole('group', { name: 'Files' })
	const image = files.getByRole('img', { name: 'Image from the answer' })
	await expect(image).toBeVisible()
	// A thumbnail three control heights square (antd's default controlHeight is 32), not the 1×1 PNG's size.
	await expect(image).toHaveCSS('width', '96px')
	await expect(image).toHaveCSS('height', '96px')
	await image.click()
	const preview = page.locator('.ant-image-preview')
	await expect(preview).toBeVisible()
	// The preview fades in; an Escape during that motion can leave antd's preview stuck mid-close (seen under
	// next dev on Markdown images too), so it is closed once it has opened.
	await expect(preview).not.toHaveClass(/-fade-appear/)
	await page.keyboard.press('Escape')
	await expect(preview).toBeHidden()
})

/** Texts unique per project, repeat and retry: the stub keeps every conversation for the whole run. */
const runOf = (testInfo: TestInfo) =>
	`${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`

/** The attach button in the Sender's prefix and the header it opens (X Sender.Header, titled "Upload file"). */
const attachButton = (page: Page) => page.getByRole('button', { name: 'Attach files', exact: true })
const uploadHint = (page: Page) => page.getByText('Click or drag a file here to upload')

/** The agent app (stub): file upload (image and document, local files) and speech to text are on. */
const openAgentChat = async (page: Page, testInfo: TestInfo) => {
	await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
	// The agent app requires a topic before anything can be sent.
	await page.getByLabel('Topic').fill(`tea ${runOf(testInfo)}`)
}

/** Picks a file through the browser's file chooser (Playwright "Upload files": the filechooser event). */
const chooseFile = async (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => {
	const chooser = page.waitForEvent('filechooser')
	await uploadHint(page).click()
	await (await chooser).setFiles(file)
}

/** The app's proxy answer to POST /files/upload: `{ code, data }`, `data` being Dify's file. */
const uploadAnswered = (page: Page) =>
	page.waitForResponse(
		response =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname.endsWith('/files/upload'),
	)
/** Every POST from the page to a path ending so, in order, for asserting that none was made. */
const postsTo = (page: Page, suffix: string) => {
	const urls: string[] = []
	page.on('request', request => {
		if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(suffix)) {
			urls.push(request.url())
		}
	})
	return urls
}
const chatRequested = (page: Page) =>
	page.waitForRequest(
		request =>
			request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/chat-messages'),
	)

test('a file attached through the prefix button is sent with the message and listed on it', async ({
	page,
}, testInfo) => {
	const text = `with an attachment ${runOf(testInfo)}`
	await openAgentChat(page, testInfo)
	await attachButton(page).click()
	await expect(uploadHint(page)).toBeVisible()
	const uploaded = uploadAnswered(page)
	await chooseFile(page, {
		name: 'note.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('hello stub'),
	})
	const fileId = ((await (await uploaded).json()) as { data: { id: string } }).data.id
	await expect(page.getByText('note.txt', { exact: true })).toBeVisible()
	const sent = chatRequested(page)
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	expect((await sent).postDataJSON()).toMatchObject({
		files: [{ type: 'document', transfer_method: 'local_file', upload_file_id: fileId }],
	})
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
	// The user bubble lists the file by its name; the Sender's header is emptied and closed.
	const userBubble = page.locator('.ant-bubble-end').filter({ hasText: text })
	await expect(userBubble.getByText('note.txt', { exact: true })).toBeVisible()
	await expect(page.getByText('note.txt', { exact: true })).toHaveCount(1)
	await expect(uploadHint(page)).toBeHidden()
})

test('a file pasted into the Sender is attached and uploaded', async ({ page }, testInfo) => {
	const text = `with a pasted attachment ${runOf(testInfo)}`
	await openAgentChat(page, testInfo)
	const uploaded = uploadAnswered(page)
	// A paste carrying a file and no text (MDN: ClipboardEvent() takes `clipboardData`, a DataTransfer).
	await senderBox(page).evaluate(textarea => {
		const data = new DataTransfer()
		data.items.add(new File(['pasted'], 'pasted.txt', { type: 'text/plain' }))
		textarea.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
		)
	})
	const fileId = ((await (await uploaded).json()) as { data: { id: string } }).data.id
	// The header opens on its own with the pasted file.
	await expect(page.getByText('pasted.txt', { exact: true })).toBeVisible()
	const sent = chatRequested(page)
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	expect((await sent).postDataJSON()).toMatchObject({
		files: [{ transfer_method: 'local_file', upload_file_id: fileId }],
	})
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
})

test('a file of a type the app does not accept is refused with a message', async ({
	page,
}, testInfo) => {
	await openAgentChat(page, testInfo)
	const uploads = postsTo(page, '/files/upload')
	await attachButton(page).click()
	// The stub app accepts images and documents only.
	await chooseFile(page, { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('mp3') })
	await expect(page.getByText('Unsupported file type: mp3', { exact: true })).toBeVisible()
	// Refused before any upload (beforeUpload runs first): no request, no card, the empty list's picker.
	expect(uploads).toEqual([])
	await expect(page.getByText('song.mp3', { exact: true })).toHaveCount(0)
	await expect(uploadHint(page)).toBeVisible()
})

// Ruling: a send while an attachment is unfinished is refused; the Sender keeps its text and the panel
// keeps the file. The app's upload proxy is held, or answers Dify's error, through page.route.
test('a send waits for an attachment that is still uploading', async ({ page }, testInfo) => {
	const text = `while it uploads ${runOf(testInfo)}`
	await openAgentChat(page, testInfo)
	let release = () => {}
	const held = new Promise<void>(resolve => {
		release = resolve
	})
	await page.route('**/files/upload', async route => {
		await held
		await route.continue()
	})
	const sends = postsTo(page, '/chat-messages')
	await attachButton(page).click()
	await chooseFile(page, { name: 'slow.txt', mimeType: 'text/plain', buffer: Buffer.from('slow') })
	await expect(page.getByText('Uploading...', { exact: true })).toBeVisible()
	await senderBox(page).fill(text)
	await senderBox(page).press('Enter')
	await expect(
		page.getByText('Wait for all files to finish uploading', { exact: true }),
	).toBeVisible()
	expect(sends).toEqual([])
	await expect(senderBox(page)).toHaveValue(text)
	await expect(page.getByText('slow.txt', { exact: true })).toBeVisible()
	// Once the upload is done, the same text goes out with the file.
	const uploaded = uploadAnswered(page)
	release()
	await uploaded
	await expect(page.getByText('Uploading...', { exact: true })).toHaveCount(0)
	const sent = chatRequested(page)
	await senderBox(page).press('Enter')
	expect((await sent).postDataJSON()).toMatchObject({ query: text, files: [{ type: 'document' }] })
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
})

test('a send is refused while an attachment failed to upload', async ({ page }, testInfo) => {
	const text = `after a failed upload ${runOf(testInfo)}`
	await openAgentChat(page, testInfo)
	// The proxy's answer to a Dify refusal: `{ code, data }` with Dify's error body (createDifyApiResponse).
	await page.route('**/files/upload', route =>
		route.fulfill({
			status: 415,
			contentType: 'application/json',
			body: JSON.stringify({
				code: 415,
				data: { code: 'unsupported_file_type', message: 'File type not allowed.', status: 415 },
			}),
		}),
	)
	const sends = postsTo(page, '/chat-messages')
	await attachButton(page).click()
	await chooseFile(page, { name: 'odd.txt', mimeType: 'text/plain', buffer: Buffer.from('odd') })
	// The failed card says why, in Dify's words.
	await expect(page.getByText('File type not allowed.', { exact: true })).toBeVisible()
	await senderBox(page).fill(text)
	await senderBox(page).press('Enter')
	await expect(
		page.getByText('Remove the files that could not be uploaded', { exact: true }),
	).toBeVisible()
	expect(sends).toEqual([])
	await expect(senderBox(page)).toHaveValue(text)
	await expect(page.getByText('odd.txt', { exact: true })).toBeVisible()
})

test('attachments and speech input are offered only when the app enables them', async ({
	page,
}) => {
	const voiceButton = page.getByRole('button', { name: 'Voice input', exact: true })
	await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
	await expect(voiceButton).toBeVisible()
	await expect(attachButton(page)).toBeVisible()
	// The plain chat app enables neither (GET /parameters: file_upload and speech_to_text off).
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	// The Sender renders once the parameters have loaded, so the checks below see the final state.
	await expect(senderBox(page)).toBeVisible()
	await expect(voiceButton).toHaveCount(0)
	await expect(attachButton(page)).toHaveCount(0)
})
