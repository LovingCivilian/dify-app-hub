import type { MessageInfo } from '@ant-design/x-sdk'

import { prependOlder } from '@/components/chat/hooks/history-paging'
import { NO_OPEN_ITEMS, openItemsOfTurn, type TurnOpenItems } from '@/lib/chat/open-items'
import { emptyAssistantTurn, type HistoryTurn, type Turn, type TurnRun } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

// One reply at a time per conversation, as useDifyChat: the Dify chat's side-effect-free module, shared (plan call P11).
export { sendDecision, type SendDecision } from '@/components/chat/hooks/send-decision'

/**
 * Any failure as the error the shared chat keeps: the browser client's RequestError as it is, anything else (a network
 * failure) without text, with the original as `cause` (the Dify chat's `toDifyError` rule: no English from the wire).
 */
export const toRequestError = (error: unknown): RequestError => {
	if (error instanceof RequestError) return error
	const wrapped = new RequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}

/** A history turn as useXChat holds it: finished, under the id the server gave it (plan call P9). */
export const toMessageInfo = ({ id, turn }: HistoryTurn): MessageInfo<Turn> => ({
	id,
	message: turn,
	status: 'success',
})

/**
 * useXChat's `requestFallback` (spec §5.2: it handles transport failures only). The turn keeps what streamed, and an
 * envelope's English `message` is never kept (charter §4.5: the view words every hub code). A run still running is
 * closed: `cancelled` for an abort (the user left a stream the Stop route could not end), the failure otherwise, and
 * its calls without a result read `stopped`, as the reloaded turn reads them after such a run (plan calls P9, P10). A
 * request that failed before any run (a refusal in the hub's envelope, spec §4.3) becomes a run of its own with no id
 * and the envelope's `code`. A turn whose last run had ended was being continued with answers (#67, plan call P11): the
 * failure is this request's, not that run's, so it is appended as a closed run with no id, and the turn keeps its
 * interrupts and waiting calls, whose cards can be answered again; an abort of that request leaves the turn as it was.
 */
export const fallbackTurn = (error: Error, current: Turn | undefined): Turn => {
	const base = current ?? emptyAssistantTurn()
	const aborted = error.name === 'AbortError'
	const failure = { code: error instanceof RequestError ? error.code : undefined, message: '' }
	const last = base.runs.at(-1)
	if (last && last.outcome !== 'running') {
		if (aborted) return base
		return { ...base, runs: [...base.runs, { runId: '', outcome: 'error', error: failure }] }
	}
	const closed: TurnRun = aborted
		? { runId: last?.runId ?? '', outcome: 'cancelled' }
		: { runId: last?.runId ?? '', outcome: 'error', error: failure }
	return {
		...base,
		parts: base.parts.map(part =>
			part.kind === 'tool' && (part.status === 'running' || part.status === 'waiting')
				? { ...part, status: 'stopped' as const }
				: part,
		),
		runs: last ? [...base.runs.slice(0, -1), closed] : [closed],
	}
}

/**
 * A retried first page goes above what was sent since the failure. The server stored those turns too, so a history
 * turn whose run is on screen is left out, with the user turn before it (a live user bubble has no stored id; its
 * answer's run ids match).
 */
export const prependLatestTurns = (
	current: MessageInfo<Turn>[],
	page: MessageInfo<Turn>[],
): MessageInfo<Turn>[] => {
	const shownRuns = new Set(
		current.flatMap(m => m.message.runs.map(run => run.runId)).filter(Boolean),
	)
	const shown = (turn: Turn) => turn.runs.some(run => shownRuns.has(run.runId))
	const kept: MessageInfo<Turn>[] = []
	for (let index = 0; index < page.length; index++) {
		const item = page[index]!
		const next = page[index + 1]
		if (
			item.message.role === 'user' &&
			next &&
			next.message.role === 'assistant' &&
			shown(next.message)
		) {
			index++
			continue
		}
		if (item.message.role === 'assistant' && shown(item.message)) continue
		kept.push(item)
	}
	return prependOlder(current, kept)
}

/**
 * What the conversation waits for: the last turn's open items when it is an answer (spec §3.3, §6;
 * lib/chat/open-items.ts), its waiting ask_user calls only while the app's switch is on (decision 62's fourth answer).
 */
export const openItemsOf = (
	messages: readonly MessageInfo<Turn>[],
	askUser: boolean,
): TurnOpenItems => {
	const last = messages.at(-1)
	return last?.message.role === 'assistant' ? openItemsOfTurn(last.message, askUser) : NO_OPEN_ITEMS
}
