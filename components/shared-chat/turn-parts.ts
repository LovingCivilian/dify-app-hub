import type { TurnPart } from '@/lib/chat/turn'

export type ToolPart = Extract<TurnPart, { kind: 'tool' }>

/** A turn's parts as the turn renders them: tool calls that follow each other form one chain (spec §5.3). */
export type PartGroup =
	| Exclude<TurnPart, ToolPart>
	| { kind: 'tools'; key: string; tools: ToolPart[] }

/** Arrival order kept (spec §5.2); consecutive tool parts are one ThoughtChain, keyed by its first call. */
export const groupParts = (parts: readonly TurnPart[]): PartGroup[] => {
	const groups: PartGroup[] = []
	for (const part of parts) {
		const last = groups.at(-1)
		if (part.kind !== 'tool') groups.push(part)
		else if (last?.kind === 'tools') last.tools.push(part)
		else groups.push({ kind: 'tools', key: part.toolCallId, tools: [part] })
	}
	return groups
}

const HINT_MAX = 60

/** The tool card's description (spec §5.3: "a short input hint"): the arguments on one line, at most 60 characters. */
export const inputHint = (args: string): string => {
	const flat = Array.from(args.replace(/\s+/g, ' ').trim())
	return flat.length > HINT_MAX ? `${flat.slice(0, HINT_MAX).join('')}…` : flat.join('')
}

/** Arguments and results for CodeHighlighter: JSON indented when it parses (streaming arguments may not yet), else as sent. */
export const prettyJson = (text: string): string => {
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}
