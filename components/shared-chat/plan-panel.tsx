'use client'

import { Collapse, Flex, Progress, Steps } from 'antd'
import type { StepsProps } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planProgress, planStepStatus, type PlanStep } from '@/lib/chat/plan-state'

/** The Collapse's one panel. */
const PANEL_KEY = 'plan'

/**
 * The agent's plan above the composer (spec §6.4, decision 47, plan call P17): the full-stack template's panel
 * (`frontend/src/components/chat/research-panel.tsx`: a "Plan 2/5" header, a progress bar, the steps by status, closed
 * once no step is left) on antd's own components: one ghost Collapse panel headed "Plan {{done}}/{{total}}", a small
 * Progress and vertical small Steps (antd 6.6.5 `Steps`: `orientation`, which replaces the deprecated `direction`; an
 * item's own `status` wins over `current`, `@rc-component/steps` `Steps.js`). Each step's description is its item's
 * title, a text node (spec §6.4: every text renders as text).
 */
export default function PlanPanel({ steps }: { steps: PlanStep[] }) {
	const { t } = useTranslation()
	const { done, total, percent, complete } = planProgress(steps)
	// A finished plan starts closed; the user opens and closes it at will.
	const [open, setOpen] = useState(!complete)
	// React "You Might Not Need an Effect" › "Adjusting some state when a prop changes": the previous value lives in
	// state and the panel is set while rendering, so it closes when the plan completes and opens again when a new one
	// starts (the template's rule, `research-panel.tsx` lines 65–71), with no Effect and no stale frame.
	const [wasComplete, setWasComplete] = useState(complete)
	if (complete !== wasComplete) {
		setWasComplete(complete)
		setOpen(!complete)
	}
	const items = useMemo<StepsProps['items']>(
		() =>
			steps.map((step, index) => ({
				key: index,
				title: step.description,
				status: planStepStatus(step.status),
			})),
		[steps],
	)
	return (
		<Collapse
			ghost
			activeKey={open ? [PANEL_KEY] : []}
			onChange={keys => setOpen(keys.includes(PANEL_KEY))}
			items={[
				{
					key: PANEL_KEY,
					label: t('shared_chat.plan.title', { done, total }),
					children: (
						<Flex
							vertical
							gap="small"
						>
							<Progress
								percent={percent}
								size="small"
							/>
							<Steps
								orientation="vertical"
								size="small"
								items={items}
							/>
						</Flex>
					),
				},
			]}
		/>
	)
}
