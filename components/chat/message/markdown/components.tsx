import type { XMarkdownProps } from '@ant-design/x-markdown'

import AnswerButton from './answer-button'
import AnswerForm from './answer-form'
import CodeBlock from './code-block'
import MarkdownImage from './markdown-image'
import MarkdownLink from './markdown-link'
import MarkdownSource from './markdown-source'
import ThinkBlock from './think-block'
import VideoBlock from './video-block'

/**
 * Tag → component map for XMarkdown. A module constant on purpose (x-markdown skill: "Prefer a stable
 * components object"; spec §6 criterion 9): XMarkdown rebuilds its parser and renderer when it changes.
 */
export const markdownComponents = {
	code: CodeBlock,
	think: ThinkBlock,
	form: AnswerForm,
	button: AnswerButton,
	img: MarkdownImage,
	video: VideoBlock,
	// Dify's file links in an answer go through the remote-file route (charter §4.1): `a` (href), `img` and `video`/`source` (src).
	a: MarkdownLink,
	source: MarkdownSource,
} as unknown as NonNullable<XMarkdownProps['components']>
