'use client'

import { Image } from 'antd'
import { useTranslation } from 'react-i18next'

import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

/** Markdown images and allowed <img> tags: antd Image with its click-to-preview. */
export default function MarkdownImage({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const { src = '', alt } = domNode.attribs ?? {}
	if (!src) return null
	return (
		<Image
			src={src}
			alt={alt || t('message.image_load_failed')}
			classNames={{ root: styles.imageRoot, image: styles.media }}
		/>
	)
}
