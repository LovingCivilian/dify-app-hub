'use client'

import { useAppContext } from '../../app-context'
import { answerLink } from '../file-link'
import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

/**
 * <video> in an answer, with a `src` or <source>/<track> children: native controls, never wider than the bubble. A Dify
 * file link in `src` goes through the remote-file route (`answerLink`; the <source> children do the same).
 */
export default function VideoBlock({ domNode, children }: MarkdownBlockProps) {
	const { difyApi } = useAppContext()
	const src = domNode.attribs?.src
	const hasElements = domNode.children?.some(child => child.type === 'tag') ?? false
	if (!src && !hasElements) return null
	return (
		<video
			className={styles.media}
			src={answerLink(src, difyApi)}
			controls
		>
			{children}
		</video>
	)
}
