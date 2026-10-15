import type { Interrupt } from '@ag-ui/core'

import { ASK_USER_TOOL_NAME } from './ask-user'
import type { ToolPart, Turn } from './turn'

/*
 * What the conversation waits for, read from the turn the browser shows (Part 2 spec §3.3, §6; decision 50: while
 * anything is open, the composer is blocked and every card has a way out). Client-safe: the browser's hook and cards
 * read it; the server's twin is lib/chat/answers.ts `openItemsOf`, which reads the store. `@ag-ui/core` is imported for
 * its types only (spec §9).
 */

/** What the conversation's last turn waits for (spec §3.3, §6): its interrupts and, while askUser is on, its waiting ask_user calls. */
export interface TurnOpenItems {
	interrupts: Interrupt[]
	questions: ToolPart[]
}

/** Nothing open: one object, so a memo that answers it keeps its identity between renders. */
export const NO_OPEN_ITEMS: TurnOpenItems = { interrupts: [], questions: [] }

/**
 * The turn's open interrupts (its last run the agent started ended on them: lib/chat/turn.ts, plan call P10) and, while
 * the app advertises ask_user, its calls to that tool still waiting for an answer (plan call P9), in call order. The
 * switch is the app's current one (decision 62, as CopilotKit, assistant-ui and the full-stack template read theirs): a
 * call left waiting while it is off does not block the composer, and the next run answers it as a call to a tool the
 * hub does not advertise (spec §6.2). A user turn, or no turn, waits for nothing.
 */
export const openItemsOfTurn = (turn: Turn | undefined, askUser: boolean): TurnOpenItems => {
	if (turn?.role !== 'assistant') return NO_OPEN_ITEMS
	const questions = askUser
		? turn.parts.filter(
				(part): part is ToolPart =>
					part.kind === 'tool' && part.name === ASK_USER_TOOL_NAME && part.status === 'waiting',
			)
		: []
	return turn.interrupts.length > 0 || questions.length > 0
		? { interrupts: turn.interrupts, questions }
		: NO_OPEN_ITEMS
}

/** Whether anything is open (the browser's twin of lib/chat/answers.ts `anyOpen`). */
export const hasOpenItems = (open: TurnOpenItems): boolean =>
	open.interrupts.length > 0 || open.questions.length > 0
