'use client'

import { Collapse, Flex, Tag, Typography } from 'antd'
import type { CollapseProps, TagProps } from 'antd'
import type { ReactNode } from 'react'

/** A card's status badge in its header: an antd Tag with a preset status `color` and an `icon`. */
export interface ChatCardBadge {
	color: TagProps['color']
	icon?: ReactNode
	label: ReactNode
}

/** How the card opens. */
type ChatCardOpening =
	/** It opens and closes at the user's click, open at first when `defaultOpen`; it starts again when that changes. */
	| { defaultOpen: boolean; fixed?: never; open?: never; onOpenChange?: never }
	/** Held open (the user must see it to act) or closed (no body): no arrow, and the header does not toggle it. */
	| { fixed: 'open' | 'closed'; defaultOpen?: never; open?: never; onOpenChange?: never }
	/** Controlled by its owner, which opens and closes it itself too (the plan panel). */
	| { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never; fixed?: never }

export type ChatCardProps = ChatCardOpening & {
	/** The header's icon, before the title. */
	icon: ReactNode
	/** The title; a long one wraps. */
	title: ReactNode
	badge?: ChatCardBadge
	/** Controls at the header's end, where the arrow sits (Collapse item `extra`). */
	extra?: ReactNode
	/** The body (none while held closed). */
	children?: ReactNode
}

/** The Collapse's one panel. */
const PANEL_KEY = 'card'

/**
 * Every card in the shared chat, in the tool card's look (the owner, 2026-10-15: "i like the new card look, so can we
 * make everything follow that?"), which follows AI Elements' `Tool` (vercel/ai-elements
 * `packages/elements/src/tool.tsx`): a bordered, rounded card that opens and closes, an antd Collapse with one panel
 * (`size`, `expandIconPlacement`, `items`, `activeKey`, `defaultActiveKey`, `onChange`; item `label`, `extra`,
 * `showArrow`, `children`: `antd info Collapse --version 6.6.5`), its header the card's icon, its title in strong text
 * and its status badge, an antd Tag with a preset status colour and an icon (the Tag "status" demo, `antd demo Tag
 * status --version 6.6.5`). The icon stays beside the title, and the title and the badge wrap below each other when
 * the title is long. A collapsible card is keyed by `defaultOpen`, so it opens when, say, its tool call completes
 * (React: resetting state with a key); a held card is held through the controlled `activeKey` with no `onChange` and
 * shows no arrow (antd: "If false, panel will not show arrow icon"); a controlled card reports the user's clicks
 * through `onOpenChange`.
 */
export default function ChatCard(props: ChatCardProps) {
	const { icon, title, badge, extra, children, fixed, onOpenChange } = props
	const opening: Pick<CollapseProps, 'activeKey' | 'defaultActiveKey' | 'onChange'> =
		fixed !== undefined
			? { activeKey: fixed === 'open' ? [PANEL_KEY] : [] }
			: onOpenChange !== undefined
				? {
						activeKey: props.open ? [PANEL_KEY] : [],
						onChange: keys => onOpenChange(keys.includes(PANEL_KEY)),
					}
				: { defaultActiveKey: props.defaultOpen ? [PANEL_KEY] : [] }
	const key = fixed ?? (onOpenChange !== undefined ? 'controlled' : String(props.defaultOpen))
	return (
		<Collapse
			key={key}
			size="small"
			expandIconPlacement="end"
			{...opening}
			items={[
				{
					key: PANEL_KEY,
					showArrow: fixed === undefined,
					label: (
						<Flex
							align="center"
							gap="small"
						>
							{icon}
							<Flex
								align="center"
								gap="small"
								wrap
							>
								<Typography.Text strong>{title}</Typography.Text>
								{badge && (
									<Tag
										color={badge.color}
										icon={badge.icon}
									>
										{badge.label}
									</Tag>
								)}
							</Flex>
						</Flex>
					),
					extra,
					children: fixed === 'closed' ? undefined : children,
				},
			]}
		/>
	)
}
