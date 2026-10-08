import type { ThoughtChainItemType } from '@ant-design/x'

import type { AgentThought } from '@/lib/dify/types'

export interface ThoughtStatusContext {
	/** The step is the reply's latest one: only that one can still be running. */
	last: boolean
	streaming: boolean
	/** How the reply was cut short, if it was: a stream error or the user's stop. */
	interrupted?: 'error' | 'abort'
}

/**
 * A tool step's ThoughtChain status. A step with an observation is done. The latest step without one is
 * running while the reply streams, and, like an unfinished workflow node (displayWorkflow), shows the
 * error or the stop that ended the reply. Any other step finished with nothing to observe.
 */
export const thoughtStatus = (
	thought: Pick<AgentThought, 'observation'>,
	{ last, streaming, interrupted }: ThoughtStatusContext,
): NonNullable<ThoughtChainItemType['status']> => {
	if (thought.observation || !last) return 'success'
	if (streaming) return 'loading'
	return interrupted ?? 'success'
}
