import type { Interrupt } from '@ag-ui/core'
import type { FormRule } from 'antd'
import type { TFunction } from 'i18next'

import {
	answerKindOf,
	approvalKey,
	isExpired,
	type AnswerKind,
	type FlatField,
} from '@/lib/chat/interrupt-answers'

import type { AnswerDraft } from './answers'

/*
 * The interrupt card's rules (Part 2 spec §6.3; plan calls P6, P7, P8, P13, P14), pure so the unit suite covers them
 * (the card itself is proven by the e2e suite). The form's messages for types and bounds come from antd's own locale
 * pack, which the app's XProvider hands to antd's ConfigProvider (components/providers/app-providers.tsx; antd 6.6.5
 * `es/config-provider/index.js` merges `locale.Form.defaultValidateMessages`; antd doc Form "validateMessages"), so
 * they follow the UI language without a key; the required message is the Dify inputs form's `form.field_required`.
 */

/** A blank answer counts as none: the rule sees what payloadOf will drop (antd doc Form, Rule `transform`). */
const blankAsEmpty = (value: unknown): unknown =>
	typeof value === 'string' && value.trim() === '' ? '' : value

/**
 * The field's antd Form rules (antd doc Form, "Rule"): a required one with the app's own message, then its type and
 * bounds. antd counts a string's `min`/`max` in code points (`@rc-component/async-validator` 6.0.0 `es/rule/range.js`
 * counts a surrogate pair once), as JSON Schema does (P7), and `min`/`max` on a number are inclusive, as `minimum` and
 * `maximum` are; `type: 'integer'` refuses a fraction.
 */
export const fieldRules = (field: FlatField, t: TFunction): FormRule[] => {
	const message = t('form.field_required', { label: field.title ?? field.name })
	// A string of spaces is no answer (antd doc Form, Rule `whitespace`: "only work with type: 'string' rule"). A rule
	// holding only `required` is checked as such for any value; one with more keys is a string rule unless typed
	// (`@rc-component/async-validator` 6.0.0 `es/index.js`, getValidationMethod), so only a string field gets it.
	const required: FormRule[] = !field.required
		? []
		: field.type === 'string'
			? [{ required: true, whitespace: true, message }]
			: [{ required: true, message }]
	switch (field.type) {
		case 'string':
			return [
				...required,
				{ type: 'string', min: field.minLength, max: field.maxLength, transform: blankAsEmpty },
			]
		case 'number':
		case 'integer':
			return [...required, { type: field.type, min: field.minimum, max: field.maximum }]
		case 'boolean':
			return [...required, { type: 'boolean' }]
		case 'enum':
			return [...required, { type: 'enum', enum: field.options }]
	}
}

/**
 * The form's initial values: each field's `default`. A boolean without one starts false, because a Switch has no
 * unset state (antd doc Switch: `checked` defaults to false): the answer is what the card shows.
 */
export const initialValuesOf = (fields: readonly FlatField[]): Record<string, unknown> =>
	Object.fromEntries(
		fields.flatMap(field =>
			field.default !== undefined
				? [[field.name, field.default]]
				: field.type === 'boolean'
					? [[field.name, false]]
					: [],
		),
	)

/**
 * The form's values as the payload (P7): only the schema's fields, without undefined, null (a cleared InputNumber
 * answers null, antd doc InputNumber `onChange`) and blank optional strings, so an untouched optional field is left
 * out rather than sent empty.
 */
export const payloadOf = (
	fields: readonly FlatField[],
	values: Record<string, unknown>,
): Record<string, unknown> =>
	Object.fromEntries(
		fields.flatMap(field => {
			const value = values[field.name]
			if (value === undefined || value === null) return []
			if (!field.required && blankAsEmpty(value) === '') return []
			return [[field.name, value]]
		}),
	)

/** AG-UI's core reasons (concepts › Interrupts, "Reason taxonomy"), each with a localised title. */
const TITLE_KEYS = {
	input_required: 'shared_chat.interrupt.title_input_required',
	confirmation: 'shared_chat.interrupt.title_confirmation',
	tool_call: 'shared_chat.interrupt.title_tool_call',
} as const

/**
 * The card's title key, or null for any other reason, which the card shows as sent ("For unknown reasons, clients
 * must not error. Render from `message`, `responseSchema`, and `metadata`", concepts › Interrupts, "Client routing").
 */
export const interruptTitleKey = (
	reason: string,
): (typeof TITLE_KEYS)[keyof typeof TITLE_KEYS] | null =>
	Object.hasOwn(TITLE_KEYS, reason) ? TITLE_KEYS[reason as keyof typeof TITLE_KEYS] : null

type DecisionKey =
	| 'shared_chat.answer.cancelled'
	| 'shared_chat.answer.approved'
	| 'shared_chat.answer.rejected'
	| 'shared_chat.answer.answered'
	| 'shared_chat.interrupt.yes'
	| 'shared_chat.interrupt.no'

/** What the card shows: the recorded decision, Dismiss for an expired interrupt, or the answer its kind allows. */
export type InterruptCardView =
	| { kind: 'decided'; tagKey: DecisionKey }
	| { kind: 'expired' }
	| AnswerKind

/**
 * P13, P14: a decision recorded in the draft shows as a Tag with "Change" until the last open item has one; an
 * expired interrupt can only be dismissed (spec §6.1), so a resolved decision it can no longer take is offered
 * Dismiss again ("Expiry forecloses ANSWERING", @ag-ui/client 1.0.2 `src/agent/agent.ts`); otherwise the answer its
 * kind allows. The draft is read by own key only: an interrupt id is the agent's string.
 */
export const interruptCardView = (
	interrupt: Interrupt,
	draft: AnswerDraft,
	now: Date,
): InterruptCardView => {
	const recorded = Object.hasOwn(draft.resume, interrupt.id)
		? draft.resume[interrupt.id]
		: undefined
	if (recorded?.status === 'cancelled')
		return { kind: 'decided', tagKey: 'shared_chat.answer.cancelled' }
	if (isExpired(interrupt, now)) return { kind: 'expired' }
	const answer = answerKindOf(interrupt)
	if (!recorded) return answer
	const { payload } = recorded
	switch (answer.kind) {
		case 'approval':
			return {
				kind: 'decided',
				tagKey:
					typeof payload === 'object' && payload[approvalKey(interrupt.responseSchema)] === true
						? 'shared_chat.answer.approved'
						: 'shared_chat.answer.rejected',
			}
		case 'confirm':
			return {
				kind: 'decided',
				tagKey: payload === true ? 'shared_chat.interrupt.yes' : 'shared_chat.interrupt.no',
			}
		default:
			return { kind: 'decided', tagKey: 'shared_chat.answer.answered' }
	}
}
