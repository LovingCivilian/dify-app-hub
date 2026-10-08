'use client'

import { useAppContext } from '../../app-context'
import { answerLink } from '../file-link'
import type { MarkdownBlockProps } from './dom-node'

/** <source> inside an answer's <video> (or <audio>, <picture>): its `src` goes through `answerLink`, the rest is kept. */
export default function MarkdownSource({ domNode }: MarkdownBlockProps) {
	const { difyApi } = useAppContext()
	const { src, type, media, srcset, sizes } = domNode.attribs ?? {}
	return (
		<source
			src={answerLink(src, difyApi)}
			type={type}
			media={media}
			srcSet={srcset}
			sizes={sizes}
		/>
	)
}
