'use client'

import { CodeHighlighter, Mermaid } from '@ant-design/x'
import type { CodeHighlighterProps, MermaidProps } from '@ant-design/x'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { useThemeContext } from '@/lib/theme'

import type { MarkdownBlockProps } from './dom-node'
import EchartsBlock from './echarts-block'
import SvgBlock from './svg-block'

const codeText = (children: React.ReactNode) =>
	typeof children === 'string' ? children : String(children ?? '')

/** Languages whose fence holds a whole document: drawn only once the fence is closed (x-markdown STREAMING.md). */
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'echarts', 'svg'])

// Dark scheme. CodeHighlighter always highlights with Prism's one-light style; its `highlightProps` go to
// react-syntax-highlighter, whose `style` replaces that theme and `customStyle` keeps the zero margin X sets.
// Mermaid's `config` is passed to mermaid.initialize (MermaidConfig `theme`). Module constants: both are effect
// or memo dependencies inside X.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}
const DARK_MERMAID: MermaidProps['config'] = { theme: 'dark' }

/** Fenced code routed by language; inline code falls through to a plain <code>. */
export default function CodeBlock({
	lang,
	block,
	children,
	className,
	streamStatus,
}: MarkdownBlockProps) {
	const { isDark } = useThemeContext()
	if (!block) return <code className={className}>{children}</code>
	const language = (lang ?? '').trim().split(/\s+/)[0]
	const code = codeText(children).replace(/\n$/, '')
	if (streamStatus === 'done') {
		if (language === 'mermaid')
			return <Mermaid config={isDark ? DARK_MERMAID : undefined}>{code}</Mermaid>
		if (language === 'echarts') return <EchartsBlock code={code} />
		if (language === 'svg') return <SvgBlock code={code} />
	}
	// Full Prism (`prismLightMode={false}`, CodeHighlighter API): loaded on first use, and it resolves the aliases
	// Dify answers use (ts, js, py, sh); the light mode loads one file per exact Prism name and warns on the rest.
	return (
		<CodeHighlighter
			lang={DIAGRAM_LANGUAGES.has(language) ? undefined : language || 'text'}
			prismLightMode={false}
			highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
		>
			{code}
		</CodeHighlighter>
	)
}
