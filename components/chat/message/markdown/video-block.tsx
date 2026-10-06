'use client'

import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

/** <video> in an answer, with a `src` or <source>/<track> children: native controls, never wider than the bubble. */
export default function VideoBlock({ domNode, children }: MarkdownBlockProps) {
	const src = domNode.attribs?.src
	const hasElements = domNode.children?.some(child => child.type === 'tag') ?? false
	if (!src && !hasElements) return null
	return (
		<video
			className={styles.media}
			src={src}
			controls
		>
			{children}
		</video>
	)
}
