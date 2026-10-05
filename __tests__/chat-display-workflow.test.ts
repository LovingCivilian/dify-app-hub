import { describe, expect, it } from 'vitest'

import { displayWorkflow } from '@/components/chat/message/display-workflow'
import type { WorkflowNode, WorkflowState } from '@/components/chat/provider/message'

const node = (id: string, status: WorkflowNode['status']): WorkflowNode => ({
	id,
	nodeId: id,
	type: 'llm',
	title: id,
	status,
})

const running: WorkflowState = {
	runId: 'run-1',
	status: 'running',
	nodes: [node('start', 'success'), node('llm', 'running'), node('tool', 'retrying')],
}

describe('displayWorkflow', () => {
	it('leaves a run alone while its reply is fine (streaming, finished or paused)', () => {
		expect(displayWorkflow({ workflow: running })).toBe(running)
		const finished: WorkflowState = { ...running, status: 'finished' }
		expect(displayWorkflow({ workflow: finished, error: { message: 'x' } })).toBe(finished)
		// A failed HITL resume keeps the paused run (and its form) as it was.
		const paused: WorkflowState = { ...running, status: 'paused' }
		expect(displayWorkflow({ workflow: paused, error: { message: 'x' } })).toBe(paused)
		expect(displayWorkflow({ error: { message: 'x' } })).toBeUndefined()
	})

	it('shows a run that a stream error ended as failed, its unfinished nodes as errors', () => {
		expect(displayWorkflow({ workflow: running, error: { message: 'boom' } })).toStrictEqual({
			runId: 'run-1',
			status: 'failed',
			nodes: [node('start', 'success'), node('llm', 'error'), node('tool', 'error')],
		})
	})

	it('does the same for a stopped reply, without changing the stored run', () => {
		const shown = displayWorkflow({ workflow: running, aborted: true })
		expect(shown?.status).toBe('failed')
		expect(shown?.nodes.map(n => n.status)).toStrictEqual(['success', 'error', 'error'])
		expect(running.status).toBe('running')
		expect(running.nodes[1].status).toBe('running')
	})
})
