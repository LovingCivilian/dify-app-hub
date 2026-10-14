'use client'

import { createContext, use } from 'react'

import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { Turn } from '@/lib/chat/turn'

import type { AnswerDraft, ItemAnswer } from './answers'

/** What the cards of the turn that waits read (spec §6; plan call P13): its open items, the decisions so far, and how to record one. */
export interface TurnAnswers {
	/** The turn that waits: the conversation's last answer while it has open items. */
	turn: Turn
	open: TurnOpenItems
	draft: AnswerDraft
	/** A request is running, or the list is not ready: the cards' buttons are disabled. */
	disabled: boolean
	now: Date
	answer: (answer: ItemAnswer) => void
	retract: (itemId: string) => void
}

/**
 * The shared chat provides it while its last turn has open items (Task 15; React 19 renders a context as its own
 * provider, react.dev `createContext`). No meaningful default exists, so the default is `null` ("If you don't have any
 * meaningful default value, specify null"): a card outside a waiting chat offers no answer.
 */
export const TurnAnswersContext = createContext<TurnAnswers | null>(null)

/**
 * The context when `turn` is the turn that waits, else null: an older answer shows its cards read-only. React's `use`
 * reads a context like `useContext` (react.dev `use`: "Unlike useContext, use can be called inside conditionals").
 */
export const useTurnAnswers = (turn: Turn): TurnAnswers | null => {
	const answers = use(TurnAnswersContext)
	return answers?.turn === turn ? answers : null
}
