import * as z from 'zod'

/*
 * The agent's plan (Part 2 spec §6.4; decision 47): shown above the composer when the conversation's state reads as
 * `{ steps: [{ description, status }] }`, the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example
 * (`Plan {steps: [{description, status}]}`; research `part2-hitl-state-files.md` §3.1, §3.2). State is "deliberately
 * unconstrained" and "an application MUST validate what it reads out of state before acting on it — rendering it"
 * (AG-UI 1.0 "State"), so it is read with zod and state of any other shape is not shown. Client-safe and pure: the plan
 * panel reads it.
 */

export interface PlanStep {
	description: string
	status: string
}

/** zod 4 "Objects": keys beside `steps`, and beside a step's two, are dropped. */
const planSchema = z.object({
	steps: z.array(z.object({ description: z.string(), status: z.string() })).min(1),
})

/** Spec §6.4: the state as `{ steps: [{ description, status }] }` with at least one step (zod), or null. */
export const planOf = (state: unknown): PlanStep[] | null => {
	const parsed = planSchema.safeParse(state)
	return parsed.success ? parsed.data.steps : null
}

/** An antd Steps item's status (antd 6.6.5 `es/steps/index.d.ts`, `StepItem.status`). */
export type PlanStepStatus = 'wait' | 'process' | 'finish' | 'error'

/** 2b's plan call P17: the template's statuses (`frontend/src/components/chat/research-panel.tsx`, 0.2.21). */
const STEP_STATUSES = new Map<string, PlanStepStatus>([
	['pending', 'wait'],
	['in_progress', 'process'],
	['completed', 'finish'],
	['blocked', 'error'],
])

/** P17: a step's status as an antd Steps status; any other status is `wait`, neutral (spec §6.4). */
export const planStepStatus = (status: string): PlanStepStatus =>
	STEP_STATUSES.get(status) ?? 'wait'

/**
 * P17: "Plan 2/5" counts the completed steps; the percent is the template's `Math.round((done / total) * 100)`; the plan
 * is complete, and the panel collapses itself, once every step is completed (spec §6.4). No steps: nothing done and
 * nothing complete (planOf never answers an empty plan).
 */
export const planProgress = (
	steps: readonly PlanStep[],
): { done: number; total: number; percent: number; complete: boolean } => {
	const done = steps.filter(step => step.status === 'completed').length
	const total = steps.length
	return {
		done,
		total,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
		complete: total > 0 && done === total,
	}
}
