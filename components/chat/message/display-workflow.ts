import type { DifyChatMessage, WorkflowNode, WorkflowState } from '../provider/message'

const UNFINISHED = new Set<WorkflowNode['status']>(['running', 'retrying'])

/**
 * The run as a bubble shows it. A reply that a stream error or the user's stop ended gets no
 * `workflow_finished`, so its run would stay `running` with spinning nodes for good: such a run is shown
 * as failed and its unfinished nodes as errors. The stored message is not changed; a paused run (a HITL
 * form waiting) is left as it is.
 */
export const displayWorkflow = (
	message: Pick<DifyChatMessage, 'workflow' | 'error' | 'aborted'>,
): WorkflowState | undefined => {
	const { workflow } = message
	if (!workflow || workflow.status !== 'running' || !(message.error || message.aborted)) {
		return workflow
	}
	return {
		...workflow,
		status: 'failed',
		nodes: workflow.nodes.map(node =>
			UNFINISHED.has(node.status) ? { ...node, status: 'error' } : node,
		),
	}
}
