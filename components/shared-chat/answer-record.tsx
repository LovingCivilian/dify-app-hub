'use client'

import type { Interrupt } from '@ag-ui/core'
import { Card, Descriptions, Flex, theme } from 'antd'
import type { ReactNode } from 'react'

import { fieldLabel } from './answer-receipt'
import CodeSection from './code-section'
import { flatFields } from './flat-fields'
import RequestMessage from './request-message'
import type { ToolDetail } from './tool-view-data'

export interface AnswerRecordProps {
	/** The interrupt answered: its message, and its schema's field titles for the values. */
	interrupt: Interrupt
	/** The values a form's answer holds (answer-receipt.ts `answeredReceipt`), or nothing to show. */
	values: ToolDetail
	/** The answer's payload, which shows as fields when it is a flat object. */
	payload: unknown
	/** The answer, in the bordered box: its receipt once it went, its Tag and Change while it waits in the draft. */
	children: ReactNode
}

/**
 * An interrupt card's body once the user answered it (interrupt-card.tsx while the answer waits in the draft,
 * answered-interrupt-card.tsx once it went), as a completed tool card's: the message and a form's values with no
 * border, each labelled as the form labelled its field (`fieldLabel`; a flat object as antd Descriptions, `antd info
 * Descriptions --version 6.6.5`, as the activity card shows one; anything else as JSON, CodeSection), then the answer
 * in the bordered box (an antd Card `size="small"`), where the open card had its buttons: the box holds only the choice
 * (the owner, 2026-10-15: "the inner border should be for the choice you selected, like in the tool"). The sections
 * keep the tool card's spacing (tool-views.tsx ToolCallDetails). Every agent string renders as text.
 */
export default function AnswerRecord({ interrupt, values, payload, children }: AnswerRecordProps) {
	const { token } = theme.useToken()
	const fields = values.kind === 'empty' ? null : flatFields(payload)
	return (
		<Flex
			vertical
			gap={token.marginSM}
		>
			{interrupt.message && <RequestMessage>{interrupt.message}</RequestMessage>}
			{fields ? (
				<Descriptions
					size="small"
					column={1}
					items={fields.map(field => ({
						key: field.key,
						label: fieldLabel(interrupt, field.key),
						children: field.value,
					}))}
				/>
			) : (
				<CodeSection detail={values} />
			)}
			<Card size="small">{children}</Card>
		</Flex>
	)
}
