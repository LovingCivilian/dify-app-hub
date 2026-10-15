import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	CloseCircleOutlined,
	FormOutlined,
	InfoCircleOutlined,
	MinusCircleOutlined,
	QuestionCircleOutlined,
	SafetyCertificateOutlined,
} from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

import type { ChatCardBadge } from './chat-card'
import { CARD_BADGES, type CardBadge, type InterruptIcon } from './chat-card-view'

/*
 * The icons of the cards beside the tool card (chat-card-view.ts decides which; `@ant-design/icons`). The badges'
 * icons are the tool card's status icons (tool-chain.tsx: completed, error, stopped, awaiting approval).
 */

/** An interrupt card's header icon: a form, a confirmation, an unbound approval, anything else. */
export const INTERRUPT_ICONS = {
	form: <FormOutlined />,
	confirm: <QuestionCircleOutlined />,
	approval: <SafetyCertificateOutlined />,
	other: <InfoCircleOutlined />,
} as const satisfies Record<InterruptIcon, ReactNode>

/** Each badge's icon; the plan's progress has none, a calm count beside the title. */
const BADGE_ICONS = {
	waiting: <ClockCircleOutlined />,
	expired: <ClockCircleOutlined />,
	answered: <CheckCircleOutlined />,
	submitted: <CheckCircleOutlined />,
	approved: <CheckCircleOutlined />,
	rejected: <CloseCircleOutlined />,
	cancelled: <MinusCircleOutlined />,
	progress: undefined,
	completed: <CheckCircleOutlined />,
} as const satisfies Record<CardBadge, ReactNode>

/** A ChatCard badge: the kind's colour, icon and words (`values` fills the plan's `{{done}}/{{total}}`). */
export const cardBadge = (
	kind: CardBadge,
	t: TFunction,
	values?: { done: number; total: number },
): ChatCardBadge => ({
	color: CARD_BADGES[kind].color,
	icon: BADGE_ICONS[kind],
	label: t(CARD_BADGES[kind].key, values),
})
