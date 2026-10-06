'use client'

import { XMarkdown, type XMarkdownProps } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import '@ant-design/x-markdown/themes/dark.css'
import '@ant-design/x-markdown/themes/light.css'
import { useMemo } from 'react'

import { useThemeContext } from '@/lib/theme'

import { markdownComponents } from './markdown/components'
import { difyDompurifyConfig } from './markdown/dompurify-config'
import styles from './markdown/markdown.module.css'
import { MarkdownMessageContext } from './markdown/message-context'
import { MarkdownSendContext } from './markdown/send-context'

export interface MessageMarkdownProps {
	content: string
	/** true while the chunk stream is still open (XMarkdown `streaming.hasNextChunk`). */
	streaming?: boolean
	/** Dify message id; think timers are remembered per message. */
	messageId?: string
	/** Posts a message back (Dify answer forms and buttons). */
	onSend?: (text: string) => void
}

// Module constants (x-markdown skill: keep them stable): XMarkdown rebuilds its parser when `config` changes
// and its renderer when `components`, `dompurifyConfig` or `streaming` change.
const markedConfig: XMarkdownProps['config'] = { extensions: Latex() }

/** The single Markdown entry point for bubbles, the welcome panel and workflow results (spec §5.2, §6). */
export default function MessageMarkdown({
	content,
	streaming = false,
	messageId,
	onSend,
}: MessageMarkdownProps) {
	const { isDark } = useThemeContext()
	const streamingOption = useMemo(
		() => ({ hasNextChunk: streaming, enableAnimation: true }),
		[streaming],
	)
	return (
		<MarkdownSendContext.Provider value={onSend}>
			<MarkdownMessageContext.Provider value={messageId}>
				<XMarkdown
					className={`${isDark ? 'x-markdown-dark' : 'x-markdown-light'} ${styles.root}`}
					content={content}
					components={markdownComponents}
					config={markedConfig}
					streaming={streamingOption}
					// x-markdown API `paragraphTag`: antd Image's wrapper is a <div>, invalid inside a <p>.
					paragraphTag="div"
					openLinksInNewTab
					dompurifyConfig={difyDompurifyConfig}
				/>
			</MarkdownMessageContext.Provider>
		</MarkdownSendContext.Provider>
	)
}
