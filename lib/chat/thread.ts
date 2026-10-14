import 'server-only'

import type { Message, ToolMessage } from '@ag-ui/core'

import type { StoredMessage } from '@/lib/data/conversations'

import { TITLE_MAX_LENGTH } from './statuses'

/*
 * The stored thread as the next run sees it (Part 2 spec §3.3), and the tool messages the hub writes itself: a call a
 * stopped, failed or crashed run left without a result (spec §3.2 step 4) and a call to a tool the hub never advertised
 * (spec §6.2, plan call P4). AG-UI "Tool calls", frontend tools: "A thread that continues MUST answer every one of them
 * first … a failure is still an answer, as a tool message with `error` set"; for a backend call cut off by a stop the
 * spec is silent, and answering it too is what Pydantic AI's history repair and Open WebUI's "incomplete" marking do
 * (`part2-proxy-stop-identity.md` §3.2, §3.3).
 */

// The four constants live in the client-safe statuses module (Task 5), which the browser's turn reducer reads too; the
// server modules keep importing them from here.
export {
	STOPPED_TOOL_CONTENT,
	STOPPED_TOOL_ERROR,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
} from './statuses'

/**
 * The next RunAgentInput's messages (spec §3.3; plan call P7): the rows in `seq` order without `activity` messages
 * ("MUST be stripped before sending", AG-UI "Activity"; @ag-ui/client's prepareRunAgentInput drops them the same way),
 * and each tool message moved right after the assistant message whose call it answers, after any result already placed
 * there. @ag-ui/client 1.0.2 inserts a TOOL_CALL_RESULT at that place for the same reason ("the provider contract that an
 * assistant tool_call is immediately followed by its tool result", src/apply/default.ts, TOOL_CALL_RESULT), while the
 * store numbers a result after the text a run streamed before it. A tool message whose call is not in the thread keeps
 * its place.
 */
export const threadForAgent = (rows: readonly StoredMessage[]): Message[] => {
	const messages = rows.map(row => row.body).filter(message => message.role !== 'activity')
	const ownerOf = new Map<string, string>()
	for (const message of messages)
		if (message.role === 'assistant')
			for (const call of message.toolCalls ?? []) ownerOf.set(call.id, message.id)
	const placed = new Map<string, ToolMessage[]>()
	const rest: Message[] = []
	for (const message of messages) {
		const owner = message.role === 'tool' ? ownerOf.get(message.toolCallId) : undefined
		if (message.role === 'tool' && owner !== undefined) {
			placed.set(owner, [...(placed.get(owner) ?? []), message])
			continue
		}
		rest.push(message)
	}
	return rest.flatMap<Message>(message =>
		message.role === 'assistant' ? [message, ...(placed.get(message.id) ?? [])] : [message],
	)
}

/**
 * The calls of the thread's assistant messages that no tool message answers, in order (spec §3.2 step 4, §6.2), with
 * each call's arguments as the agent streamed them (AG-UI 1.0 `ToolCall.function.arguments`, a JSON string), which the
 * open questions read (lib/chat/answers.ts).
 */
export const unansweredToolCalls = (
	messages: readonly Message[],
): { toolCallId: string; name: string; args: string }[] => {
	const answered = new Set(
		messages.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
	)
	return messages.flatMap(message =>
		message.role === 'assistant'
			? (message.toolCalls ?? [])
					.filter(call => !answered.has(call.id))
					.map(call => ({
						toolCallId: call.id,
						name: call.function.name,
						args: call.function.arguments,
					}))
			: [],
	)
}

/** A tool message the hub writes to answer a call (AG-UI 1.0 `ToolMessage`: `content` required, `error` optional). */
export const errorToolMessage = (toolCallId: string, error: string, content: string): Message => ({
	id: crypto.randomUUID(),
	role: 'tool',
	toolCallId,
	content,
	error,
})

/**
 * A conversation's title from its first user message (spec §3.1): trimmed, its runs of white space folded into one
 * space so a title stays on one line, and cut at TITLE_MAX_LENGTH characters. A string iterates by code points
 * (MDN "String.prototype[Symbol.iterator]()"), so `Array.from` never splits a character made of a surrogate pair.
 */
export const titleFrom = (text: string): string =>
	Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, TITLE_MAX_LENGTH).join('').trimEnd()
