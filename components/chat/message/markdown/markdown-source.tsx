'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'

/** <source> inside an answer's <video> (or <audio>, <picture>): its `src` goes through the chat's link rewrite, the rest is kept. */
export default function MarkdownSource({ domNode }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const { src, type, media, srcset, sizes } = domNode.attribs ?? {}
	return (
		<source
			src={rewriteLink(src)}
			type={type}
			media={media}
			srcSet={srcset}
			sizes={sizes}
		/>
	)
}
