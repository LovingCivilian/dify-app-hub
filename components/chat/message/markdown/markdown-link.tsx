'use client'

import { useAppContext } from '../../app-context'
import { answerLink } from '../file-link'
import type { MarkdownBlockProps } from './dom-node'

/**
 * Links in an answer. XMarkdown's `openLinksInNewTab` already wrote `target` and `rel` on the Markdown links; only the
 * `href` changes here, and only for a link Dify wrote for one of its files (it goes through the app's remote-file
 * route, charter §4.1). The attributes a Markdown link carries are passed on, never the renderer's own props.
 */
export default function MarkdownLink({ domNode, children, className }: MarkdownBlockProps) {
	const { difyApi } = useAppContext()
	const { href, target, rel, title } = domNode.attribs ?? {}
	return (
		<a
			className={className || undefined}
			href={answerLink(href, difyApi)}
			target={target}
			rel={rel}
			title={title}
		>
			{children}
		</a>
	)
}
