import { describe, expect, it } from 'vitest'

import {
	humanInputInitialValues,
	humanInputPhase,
	humanInputSubmission,
} from '@/components/chat/message/human-input-phase'
import type { HumanInputState } from '@/components/chat/provider/message'

const base: HumanInputState = {
	state: 'pending',
	formToken: 'ft',
	formContent: 'Review',
	inputs: [],
	actions: [],
	defaults: {},
	expiresAt: 2_000,
	workflowRunId: 'run',
}

describe('humanInputPhase', () => {
	it('is pending before expiry', () => expect(humanInputPhase(base, 1_000)).toBe('pending'))
	// Review Focus 5: a form whose expiration_time is already past when it arrives is expired, not a negative countdown.
	it('is expired once the expiry time has passed, even if the event still says pending', () =>
		expect(humanInputPhase(base, 2_001)).toBe('expired'))
	it('is filled or expired when the stream said so, whatever the clock says', () => {
		expect(humanInputPhase({ ...base, state: 'filled' }, 9_999)).toBe('filled')
		expect(humanInputPhase({ ...base, state: 'expired' }, 0)).toBe('expired')
	})
	it('stays pending without an expiry time', () =>
		expect(humanInputPhase({ ...base, expiresAt: 0 }, 9_999)).toBe('pending'))
})

// OpenAPI, GET /form/human_input: `resolved_default_values` holds the defaults that resolve from a workflow
// variable; a `constant` default's `value` "is used as a literal string".
describe('humanInputInitialValues', () => {
	it('starts paragraphs from the resolved defaults, then from their constant defaults', () => {
		expect(
			humanInputInitialValues({
				...base,
				inputs: [
					{
						type: 'paragraph',
						output_variable_name: 'summary',
						default: { type: 'variable', selector: ['llm', 'text'] },
					},
					{
						type: 'paragraph',
						output_variable_name: 'note',
						default: { type: 'constant', value: 'Looks fine', selector: [] },
					},
					{ type: 'paragraph', output_variable_name: 'empty', default: null },
					{
						type: 'select',
						output_variable_name: 'priority',
						option_source: { type: 'constant', value: ['low', 'high'] },
					},
				],
				defaults: { summary: 'Draft text' },
			}),
		).toStrictEqual({ summary: 'Draft text', note: 'Looks fine' })
	})
	it('prefers the resolved value over a constant one', () => {
		expect(
			humanInputInitialValues({
				...base,
				inputs: [
					{
						type: 'paragraph',
						output_variable_name: 'note',
						default: { type: 'constant', value: 'constant' },
					},
				],
				defaults: { note: 'resolved' },
			}),
		).toStrictEqual({ note: 'resolved' })
	})
})

// OpenAPI, POST /form/human_input: "Paragraph and select inputs take a string; a `file` input takes one file
// mapping; a `file-list` input takes an array of file mappings."
describe('humanInputSubmission', () => {
	const inputs: HumanInputState['inputs'] = [
		{ type: 'paragraph', output_variable_name: 'feedback' },
		{ type: 'select', output_variable_name: 'priority' },
		{ type: 'file', output_variable_name: 'attachment' },
		{ type: 'file-list', output_variable_name: 'attachments' },
	]
	const uploaded = {
		uid: 'rc-1',
		name: 'a.png',
		status: 'done',
		type: 'image',
		transfer_method: 'local_file',
		upload_file_id: 'u1',
		percent: 100,
	}
	it('sends paragraphs and selects as strings and files as the documented file mappings', () => {
		expect(
			humanInputSubmission(inputs, {
				feedback: 'Looks good',
				priority: 'high',
				attachment: uploaded,
				attachments: [
					{ ...uploaded, upload_file_id: 'u2', type: 'document' },
					{
						uid: 'rc-3',
						name: 'r.pdf',
						type: 'document',
						transfer_method: 'remote_url',
						remote_url: 'https://example.com/r.pdf',
					},
				],
			}),
		).toStrictEqual({
			feedback: 'Looks good',
			priority: 'high',
			attachment: { transfer_method: 'local_file', upload_file_id: 'u1', type: 'image' },
			attachments: [
				{ transfer_method: 'local_file', upload_file_id: 'u2', type: 'document' },
				{ transfer_method: 'remote_url', url: 'https://example.com/r.pdf', type: 'document' },
			],
		})
	})
	it('sends an empty string for an untouched text field and leaves out files still uploading', () => {
		expect(
			humanInputSubmission(inputs, {
				attachment: { ...uploaded, status: 'uploading', upload_file_id: undefined },
				attachments: [{ ...uploaded, status: 'uploading', upload_file_id: undefined }],
			}),
		).toStrictEqual({ feedback: '', priority: '', attachment: undefined, attachments: [] })
	})
})
