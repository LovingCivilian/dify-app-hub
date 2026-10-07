'use client'

import { Image } from 'antd'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../../app-context'
import { answerLink } from '../file-link'
import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

/**
 * Markdown images and allowed <img> tags: antd Image with its click-to-preview. A file Dify wrote into the answer loads
 * through the app's remote-file route (`answerLink`), never from the Dify host.
 */
export default function MarkdownImage({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const { difyApi } = useAppContext()
	const { src = '', alt } = domNode.attribs ?? {}
	if (!src) return null
	return (
		<Image
			src={answerLink(src, difyApi)}
			alt={alt || t('message.image_alt')}
			classNames={{ root: styles.imageRoot, image: styles.media }}
		/>
	)
}
