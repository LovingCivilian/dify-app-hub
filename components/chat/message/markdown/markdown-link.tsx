'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'

/**
 * Links in an answer. XMarkdown's `openLinksInNewTab` already wrote `target` and `rel` on the Markdown links; only the
 * `href` goes through the chat's link rewrite (MarkdownLinkContext: in the Dify chat, a link Dify wrote for one of its
 * files goes through the app's remote-file route, charter §4.1). The attributes a Markdown link carries are passed on, never the renderer's own props.
 */
export default function MarkdownLink({ domNode, children, className }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const { href, target, rel, title } = domNode.attribs ?? {}
	return (
		<a
			className={className || undefined}
			href={rewriteLink(href)}
			target={target}
			rel={rel}
			title={title}
		>
			{children}
		</a>
	)
}
