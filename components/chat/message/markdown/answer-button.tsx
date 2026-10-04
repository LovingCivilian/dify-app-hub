'use client'

import { Button } from 'antd'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownSend } from './send-context'

/** <button data-message="…">: Dify answers that offer a follow-up to send. */
export default function AnswerButton({ domNode, children }: MarkdownBlockProps) {
	const send = useMarkdownSend()
	const message = domNode.attribs?.['data-message']
	return (
		<Button
			size="small"
			onClick={() => message && send?.(message)}
		>
			{children}
		</Button>
	)
}
