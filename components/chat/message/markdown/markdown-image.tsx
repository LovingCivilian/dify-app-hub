'use client'

import { Image } from 'antd'
import { useTranslation } from 'react-i18next'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'
import styles from './markdown.module.css'

/**
 * Markdown images and allowed <img> tags: antd Image with its click-to-preview. The chat's link rewrite decides where
 * the image loads from (MarkdownLinkContext): in the Dify chat, a file Dify wrote into the answer loads through the
 * app's remote-file route, never from the Dify host.
 */
export default function MarkdownImage({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const rewriteLink = useMarkdownLink()
	const { src = '', alt } = domNode.attribs ?? {}
	if (!src) return null
	return (
		<Image
			src={rewriteLink(src)}
			alt={alt || t('message.image_alt')}
			classNames={{ root: styles.imageRoot, image: styles.media }}
		/>
	)
}
