import { describe, expect, it } from 'vitest'

import { applyFormDefinition } from '@/components/chat/message/human-input-definition'
import type { HumanInputState } from '@/components/chat/provider/message'

const fromStream: HumanInputState = {
	state: 'pending',
	formToken: 'tok',
	formContent: 'Review the draft',
	inputs: [{ type: 'select', output_variable_name: 'priority' }],
	actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
	defaults: {},
	expiresAt: 100,
	workflowRunId: 'run-1',
	nodeId: 'n1',
}

describe('applyFormDefinition', () => {
	it('takes the documented fields of GET /form/human_input over the stream’s', () => {
		const next = applyFormDefinition(fromStream, {
			form_content: 'Review the draft, please',
			inputs: [
				{
					type: 'select',
					output_variable_name: 'priority',
					option_source: { type: 'constant', value: ['low', 'high'] },
				},
			],
			resolved_default_values: { priority: 'low' },
			user_actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			expiration_time: 200,
		})
		expect(next).toEqual({
			...fromStream,
			formContent: 'Review the draft, please',
			inputs: [
				{
					type: 'select',
					output_variable_name: 'priority',
					option_source: { type: 'constant', value: ['low', 'high'] },
				},
			],
			actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			defaults: { priority: 'low' },
			expiresAt: 200,
		})
	})
	it('keeps the token, the run and the node', () => {
		const next = applyFormDefinition(fromStream, {
			form_content: '',
			inputs: [],
			resolved_default_values: {},
			user_actions: [],
			expiration_time: 0,
		})
		expect(next).toMatchObject({
			formToken: 'tok',
			workflowRunId: 'run-1',
			nodeId: 'n1',
			state: 'pending',
		})
	})
})
