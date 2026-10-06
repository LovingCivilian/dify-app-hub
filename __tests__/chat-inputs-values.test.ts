import { gzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import {
	apiInputs,
	decodeLinkInputs,
	decodeSenderText,
	inputFields,
	pendingFileInputs,
	resolveInitialInputs,
	type InputDefinition,
	type ResolveArgs,
} from '@/components/chat/chat-view/inputs-values'

const form: InputDefinition[] = [
	{
		'text-input': {
			label: 'Topic',
			variable: 'topic',
			required: true,
			default: 'tea',
			type: 'text-input' as const,
		},
	},
	{
		select: {
			label: 'Tone',
			variable: 'tone',
			required: false,
			default: '',
			options: ['warm', 'cool'],
			type: 'select' as const,
		},
	},
]

const base: ResolveArgs = {
	form,
	urlValues: {},
	globalParams: {},
	conversationInputs: {},
	isTemp: true,
	allowUpdate: false,
	seeded: false,
}

// toStrictEqual: every input has its key (undefined when empty), so setFieldsValue clears the values the
// previous conversation left in the form.
describe('resolveInitialInputs', () => {
	it('uses the defaults for a new conversation without URL or stored values', () => {
		expect(resolveInitialInputs(base)).toStrictEqual({ topic: 'tea', tone: undefined })
	})
	it('prefers URL values on a new conversation', () => {
		expect(
			resolveInitialInputs({
				...base,
				urlValues: { topic: 'coffee' },
				globalParams: { tone: 'cool' },
			}),
		).toStrictEqual({ topic: 'coffee', tone: 'cool' })
	})
	it('uses the conversation inputs for an existing conversation unless updates are allowed', () => {
		expect(
			resolveInitialInputs({
				...base,
				urlValues: { topic: 'coffee' },
				conversationInputs: { topic: 'mate', tone: 'warm' },
				isTemp: false,
			}),
		).toStrictEqual({ topic: 'mate', tone: 'warm' })
		expect(
			resolveInitialInputs({
				...base,
				urlValues: { topic: 'coffee' },
				conversationInputs: { topic: 'mate' },
				isTemp: false,
				allowUpdate: true,
			}),
		).toStrictEqual({ topic: 'coffee', tone: undefined })
	})
	it('keeps the stored values of an existing conversation that allows updates when no link applies', () => {
		expect(
			resolveInitialInputs({
				...base,
				conversationInputs: { topic: 'mate', tone: 'warm' },
				isTemp: false,
				allowUpdate: true,
			}),
		).toStrictEqual({ topic: 'mate', tone: 'warm' })
	})
	it('restores what was typed into a new conversation when no URL value applies', () => {
		expect(resolveInitialInputs({ ...base, conversationInputs: { topic: 'mate' } })).toStrictEqual({
			topic: 'mate',
			tone: undefined,
		})
	})
})

describe('resolveInitialInputs, link values apply once per conversation', () => {
	const link = { urlValues: { topic: 'coffee' }, globalParams: { tone: 'cool' } }
	it('applies the link on the first open and leaves typed values alone on the next', () => {
		expect(resolveInitialInputs({ ...base, ...link })).toStrictEqual({
			topic: 'coffee',
			tone: 'cool',
		})
		expect(
			resolveInitialInputs({
				...base,
				...link,
				conversationInputs: { topic: 'mate', tone: 'warm' },
				seeded: true,
			}),
		).toStrictEqual({ topic: 'mate', tone: 'warm' })
	})
	it('does the same when updates are allowed on an existing conversation', () => {
		const existing = { ...base, ...link, isTemp: false, allowUpdate: true }
		expect(
			resolveInitialInputs({ ...existing, conversationInputs: { topic: 'mate' } }),
		).toStrictEqual({ topic: 'coffee', tone: 'cool' })
		expect(
			resolveInitialInputs({ ...existing, conversationInputs: { topic: 'mate' }, seeded: true }),
		).toStrictEqual({ topic: 'mate', tone: undefined })
	})
	it('falls back to the defaults once seeded when nothing was stored', () => {
		expect(resolveInitialInputs({ ...base, ...link, seeded: true })).toStrictEqual({
			topic: 'tea',
			tone: undefined,
		})
	})
})

describe('inputFields', () => {
	const unknown = {
		external_data_tool: { label: 'Weather', variable: 'weather', required: true, default: '' },
	} as unknown as InputDefinition
	const numberInput: InputDefinition = {
		number: { label: 'Count', variable: 'count', required: false, default: '', type: 'number' },
	}

	it('keeps the six control types Dify offers, in order', () => {
		const all: InputDefinition[] = [
			...form,
			numberInput,
			{ paragraph: { label: 'Notes', variable: 'notes', required: false, default: '' } } as never,
			{ file: { label: 'File', variable: 'file', required: false, default: '' } } as never,
			{
				'file-list': { label: 'Files', variable: 'files', required: false, default: '' },
			} as never,
		]
		expect(inputFields(all).map(field => field.variable)).toStrictEqual([
			'topic',
			'tone',
			'count',
			'notes',
			'file',
			'files',
		])
	})
	it('drops items of any other control type, empty items included', () => {
		expect(
			inputFields([form[0], unknown, {}, numberInput]).map(field => field.variable),
		).toStrictEqual(['topic', 'count'])
	})
	it('gives no input to a form of unsupported items only, and resolves no value for them', () => {
		expect(inputFields([unknown])).toStrictEqual([])
		expect(resolveInitialInputs({ ...base, form: [unknown, form[0]] })).toStrictEqual({
			topic: 'tea',
		})
	})
	it('takes the type from the field, or from the control key when the field has none', () => {
		const field = { label: 'Topic', variable: 'topic', required: false, default: '' }
		expect(inputFields([{ select: field } as never])[0].type).toBe('select')
	})
})

describe('decodeLinkInputs', () => {
	/** A link's input value as `unParseGzipString` reads it (the URL decoding has happened already). */
	const gzip = (text: string) => gzipSync(text).toString('base64')

	it("decodes the form's variables the link carries and reports one that does not decode", () => {
		// unParseGzipString logs the failure it returns.
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		const link: Record<string, string> = {
			topic: gzip('green tea'),
			tone: 'not-gzip',
			other: gzip('not an input'),
		}
		const failed: string[] = []
		expect(
			decodeLinkInputs(
				form,
				variable => link[variable],
				variable => failed.push(variable),
			),
		).toStrictEqual({ topic: 'green tea' })
		expect(failed).toStrictEqual(['tone'])
		log.mockRestore()
	})

	it('reads nothing for the variables the link lacks', () => {
		const failed: string[] = []
		expect(
			decodeLinkInputs(
				form,
				() => null,
				variable => failed.push(variable),
			),
		).toStrictEqual({})
		expect(failed).toStrictEqual([])
	})
})

describe('decodeSenderText', () => {
	it('decodes the percent-encoded text the link carries on top of the URL decoding', () => {
		expect(decodeSenderText('hello%20world')).toBe('hello world')
		expect(decodeSenderText(null)).toBe('')
	})
	it('keeps a text that is not valid percent-encoding as it is', () => {
		expect(decodeSenderText('100% sure')).toBe('100% sure')
	})
})

// Task 10 ruling, ported from the old form's normalizeFieldValue: a conversation's stored file inputs (GET
// /conversations `inputs`: `filename`, `remote_url`, `related_id` …) open in the file control's shape.
describe('stored file inputs', () => {
	const fileForm: InputDefinition[] = [
		form[0],
		{ file: { label: 'Brief', variable: 'brief', required: false, default: '', type: 'file' } },
		{
			'file-list': {
				label: 'Sources',
				variable: 'sources',
				required: false,
				default: '',
				type: 'file-list',
			},
		},
	]
	const storedFile = (id: string, filename: string) => ({
		dify_model_identity: '__dify__file__',
		id: null,
		tenant_id: 't1',
		type: 'document',
		transfer_method: 'local_file',
		remote_url: '',
		related_id: id,
		filename,
		extension: '.pdf',
		mime_type: 'application/pdf',
		size: 3,
	})
	const opened = resolveInitialInputs({
		...base,
		form: fileForm,
		conversationInputs: {
			topic: 'mate',
			brief: storedFile('up-1', 'brief.pdf'),
			sources: [storedFile('up-2', 'a.pdf'), storedFile('up-3', 'b.pdf')],
		},
		isTemp: false,
	})

	it('maps a file and a file list to the control shape (name, link, upload id, done)', () => {
		expect(opened.topic).toBe('mate')
		expect(opened.brief).toMatchObject({
			uid: 'up-1',
			name: 'brief.pdf',
			status: 'done',
			upload_file_id: 'up-1',
		})
		expect(opened.sources).toMatchObject([
			{ name: 'a.pdf', upload_file_id: 'up-2' },
			{ name: 'b.pdf', upload_file_id: 'up-3' },
		])
	})
	it('sends them back in the API shape (OpenAPI InputFileObject) when the inputs go out again', () => {
		expect(apiInputs(fileForm, opened)).toStrictEqual({
			topic: 'mate',
			brief: { type: 'document', transfer_method: 'local_file', upload_file_id: 'up-1' },
			sources: [
				{ type: 'document', transfer_method: 'local_file', upload_file_id: 'up-2' },
				{ type: 'document', transfer_method: 'local_file', upload_file_id: 'up-3' },
			],
		})
	})
	it('names the files a send must wait for or have removed: uploading or failed, in either input', () => {
		const uploading = { uid: 'rc-1', name: 'x.pdf', status: 'uploading', type: 'document' }
		const failed = { uid: 'rc-2', name: 'y.pdf', status: 'error', type: 'document' }
		const done = opened.brief
		expect(
			pendingFileInputs(fileForm, {
				topic: 'tea',
				brief: uploading,
				sources: [done, failed, 'not a file'],
			}),
		).toStrictEqual({ uploading: [uploading], failed: [failed] })
		expect(pendingFileInputs(fileForm, opened)).toStrictEqual({ uploading: [], failed: [] })
		// A text input whose value happens to look like a file is not a file input.
		expect(pendingFileInputs(fileForm, { topic: uploading })).toStrictEqual({
			uploading: [],
			failed: [],
		})
	})
	it('leaves out files still uploading and keeps every other value as it is', () => {
		expect(
			apiInputs(fileForm, {
				topic: 'tea',
				brief: { uid: 'rc-1', name: 'x.pdf', status: 'uploading', type: 'document' },
				sources: undefined,
				extra: 3,
			}),
		).toStrictEqual({ topic: 'tea', brief: undefined, sources: undefined, extra: 3 })
	})
})
