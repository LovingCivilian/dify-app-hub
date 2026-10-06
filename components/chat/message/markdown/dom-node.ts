/**
 * Structural view of the props `@ant-design/x-markdown` passes to a `components` entry (installed
 * `XMarkdown/interface.d.ts`, `ComponentProps`: `domNode`, `streamStatus`, `lang`, `block`, plus the tag's
 * attributes). `domNode` is html-react-parser's node; reading `attribs` and `children` through this shape
 * avoids narrowing its union in every block, and `components.tsx` casts the map once.
 */
export interface DomNode {
	type: string
	name?: string
	attribs?: Record<string, string>
	children?: DomNode[]
	data?: string
}

export interface MarkdownBlockProps {
	domNode: DomNode
	streamStatus: 'loading' | 'done'
	lang?: string
	block?: boolean
	children?: React.ReactNode
	className?: string
}

/** Concatenated text of a node's descendants (label and button captions inside an answer form). */
export const textOf = (node?: DomNode): string =>
	(node?.children ?? [])
		.map(child => (child.type === 'text' ? (child.data ?? '') : textOf(child)))
		.join('')
