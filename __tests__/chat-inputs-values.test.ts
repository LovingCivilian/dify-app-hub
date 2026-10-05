import { describe, expect, it } from 'vitest'

import {
	decodeSenderText,
	inputFields,
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

describe('decodeSenderText', () => {
	it('decodes the percent-encoded text the link carries on top of the URL decoding', () => {
		expect(decodeSenderText('hello%20world')).toBe('hello world')
		expect(decodeSenderText(null)).toBe('')
	})
	it('keeps a text that is not valid percent-encoding as it is', () => {
		expect(decodeSenderText('100% sure')).toBe('100% sure')
	})
})
