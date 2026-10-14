'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'
import styles from './markdown.module.css'

/**
 * <video> in an answer, with a `src` or <source>/<track> children: native controls, never wider than the bubble. The
 * `src` goes through the chat's link rewrite (MarkdownLinkContext; the <source> children do the same).
 */
export default function VideoBlock({ domNode, children }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const src = domNode.attribs?.src
	const hasElements = domNode.children?.some(child => child.type === 'tag') ?? false
	if (!src && !hasElements) return null
	return (
		<video
			className={styles.media}
			src={rewriteLink(src)}
			controls
		>
			{children}
		</video>
	)
}
