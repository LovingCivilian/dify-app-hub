/*
 * The sends that wait in useXChat's queue while a conversation's history loads (use-x-chat: queueRequest), by
 * conversation key. Shared by the Dify chat's hook and the shared chat's (#68, plan call P12), so the two do not
 * diverge; side-effect-free like send-decision.ts. A hook keeps one per instance (useState's initializer, React
 * "Avoiding recreating the initial state"), as x-sdk keeps its queue per hook (`messageQueueRef`, x-sdk 2.9.0
 * `es/x-chat/index.js`), so a flag never outlives the queue it stands for.
 */

export interface QueuedSends {
	has(key: string): boolean
	add(key: string): void
	/** The key's queued send has left, or its reply ended: nothing waits for it any more. */
	clear(key: string): void
}

/**
 * `has` answers at once, so two quick sends see the first. `onChange` gets a new Set after each change, for the React
 * state that renders the view's guard (React compares state with `Object.is`, so the same Set mutated would not
 * re-render). Adding a key already queued, or clearing a key that is not, changes nothing and calls nothing, so a hook
 * may clear on every render that requests.
 */
export const createQueuedSends = (onChange: (keys: ReadonlySet<string>) => void): QueuedSends => {
	const keys = new Set<string>()
	return {
		has: key => keys.has(key),
		add: key => {
			if (keys.has(key)) return
			keys.add(key)
			onChange(new Set(keys))
		},
		clear: key => {
			if (!keys.delete(key)) return
			onChange(new Set(keys))
		},
	}
}
