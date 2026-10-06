import { describe, expect, it } from 'vitest'

import {
	DIFY_PLACEHOLDER_NAME,
	groupFor,
	mergeServerList,
	regroup,
	toConversationItem,
	type ConversationItem,
} from '@/components/chat/provider/conversations'

const APP = 'app-1'
// Local-time constructors: the groups are the viewer's calendar days, so these hold in any machine
// timezone (month and day overflow is normalised by Date, also across a DST change).
const local = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
	new Date(year, month, day, hour, minute, second).getTime()
const NOW = local(2026, 9, 4, 12) // 2026-10-04 12:00 local
const seconds = (date: number) => Math.floor(date / 1000)
/** `days` calendar days before 2026-10-04, at the given local time. */
const daysAgo = (days: number, hour = 12, minute = 0, second = 0) =>
	local(2026, 9, 4 - days, hour, minute, second)

describe('groupFor', () => {
	it('buckets by calendar distance from today', () => {
		expect(groupFor(seconds(NOW - 3600_000), NOW)).toBe('today')
		expect(groupFor(seconds(daysAgo(1, 23)), NOW)).toBe('yesterday')
		expect(groupFor(seconds(daysAgo(3, 9)), NOW)).toBe('week')
		expect(groupFor(seconds(local(2026, 8, 1, 9)), NOW)).toBe('older')
	})
	it('switches at local midnight, not after 24 hours', () => {
		expect(groupFor(seconds(daysAgo(0, 0)), NOW)).toBe('today')
		expect(groupFor(seconds(daysAgo(1, 23, 59, 59)), NOW)).toBe('yesterday')
		expect(groupFor(seconds(daysAgo(1, 0)), NOW)).toBe('yesterday')
		expect(groupFor(seconds(daysAgo(2, 23, 59, 59)), NOW)).toBe('week')
	})
	it('keeps a chat from just after local midnight under today', () => {
		// 00:30 local is the previous day in UTC for a viewer east of Greenwich (Egypt: UTC+2/+3).
		const morning = local(2026, 9, 4, 10)
		expect(groupFor(seconds(local(2026, 9, 4, 0, 30)), morning)).toBe('today')
		expect(groupFor(seconds(local(2026, 9, 3, 23, 30)), morning)).toBe('yesterday')
	})
	it('counts six calendar days back as the week and seven as older', () => {
		expect(groupFor(seconds(daysAgo(6, 23, 59, 59)), NOW)).toBe('week')
		expect(groupFor(seconds(daysAgo(6, 0)), NOW)).toBe('week')
		expect(groupFor(seconds(daysAgo(7, 23, 59, 59)), NOW)).toBe('older')
	})
	it('counts whole calendar days across a DST change', () => {
		// 2026-03-08 has 23 hours in the US and 2026-11-01 has 25; counting 24-hour blocks would be one bucket off.
		const afterSpring = local(2026, 2, 9, 12)
		expect(groupFor(seconds(local(2026, 2, 8, 12)), afterSpring)).toBe('yesterday')
		expect(groupFor(seconds(local(2026, 2, 8, 0)), afterSpring)).toBe('yesterday')
		const weekAfterSpring = local(2026, 2, 14, 12)
		expect(groupFor(seconds(local(2026, 2, 8, 0)), weekAfterSpring)).toBe('week')
		expect(groupFor(seconds(local(2026, 2, 7, 23, 59, 59)), weekAfterSpring)).toBe('older')
		const afterFall = local(2026, 10, 2, 0, 30)
		expect(groupFor(seconds(local(2026, 10, 1, 23, 30)), afterFall)).toBe('yesterday')
		expect(groupFor(seconds(local(2026, 9, 27, 12)), afterFall)).toBe('week')
		expect(groupFor(seconds(local(2026, 9, 26, 12)), afterFall)).toBe('older')
	})
	it('files a timestamp from the future (clock skew) under today', () => {
		expect(groupFor(seconds(NOW + 3 * 3600_000), NOW)).toBe('today')
		expect(groupFor(seconds(daysAgo(-5)), NOW)).toBe('today')
	})
})

describe('toConversationItem', () => {
	const dify = {
		id: 'c1',
		name: 'Tea',
		created_at: seconds(NOW) - 10,
		updated_at: seconds(NOW) - 5,
		inputs: { topic: 'tea' },
		introduction: '',
		status: 'normal',
	} as const

	it('keys the item by app and Dify id and carries name, inputs and group', () => {
		expect(toConversationItem(APP, dify, NOW)).toEqual({
			key: `${APP}:c1`,
			label: 'Tea',
			difyId: 'c1',
			updatedAt: seconds(NOW) - 5,
			inputs: { topic: 'tea' },
			group: 'today',
		})
	})
	it('groups by updated_at, not created_at', () => {
		const item = toConversationItem(
			APP,
			{ ...dify, created_at: seconds(local(2026, 8, 1)), updated_at: seconds(NOW) },
			NOW,
		)
		expect(item.group).toBe('today')
	})
	it('falls back to empty inputs when Dify sends none', () => {
		const { inputs: _inputs, ...withoutInputs } = dify
		expect(toConversationItem(APP, withoutInputs as never, NOW).inputs).toEqual({})
	})
})

describe('mergeServerList', () => {
	const temp: ConversationItem = {
		key: `${APP}:temp:1`,
		label: 'New conversation',
		updatedAt: seconds(NOW),
		inputs: {},
		group: 'today',
	}
	const sentTemp: ConversationItem = { ...temp, key: `${APP}:temp:2`, difyId: 'c9' }
	const server = (id: string, label: string): ConversationItem => ({
		key: `${APP}:${id}`,
		label,
		difyId: id,
		updatedAt: seconds(NOW) - 1,
		inputs: {},
		group: 'today',
	})

	it('keeps an unsent temporary conversation at the top', () => {
		expect(mergeServerList([temp], [server('c1', 'One')]).map(c => c.key)).toEqual([
			temp.key,
			`${APP}:c1`,
		])
	})
	it('keeps the client key of a conversation the server now knows and takes the server label', () => {
		const merged = mergeServerList([sentTemp], [server('c9', 'Server name'), server('c1', 'One')])
		expect(merged.map(c => c.key)).toEqual([`${APP}:temp:2`, `${APP}:c1`])
		expect(merged[0]).toMatchObject({ difyId: 'c9', label: 'Server name' })
	})
	it('takes the server updatedAt, inputs and group for a conversation it keeps', () => {
		const stale: ConversationItem = {
			...sentTemp,
			updatedAt: seconds(daysAgo(3)),
			group: 'week',
		}
		const fresh = { ...server('c9', 'Server name'), inputs: { topic: 'tea' } }
		expect(mergeServerList([stale], [fresh])).toEqual([{ ...fresh, key: `${APP}:temp:2` }])
	})
	it('keeps several unsent temporaries in their order, above the server list in its order', () => {
		const second: ConversationItem = { ...temp, key: `${APP}:temp:3` }
		expect(
			mergeServerList([temp, second], [server('c2', 'Two'), server('c1', 'One')]).map(c => c.key),
		).toEqual([temp.key, second.key, `${APP}:c2`, `${APP}:c1`])
	})
	it('drops client items the server no longer has', () => {
		expect(
			mergeServerList([server('gone', 'Gone')], [server('c1', 'One')]).map(c => c.difyId),
		).toEqual(['c1'])
	})
	it('keeps the active conversation in place when the server page lacks it', () => {
		// A deep-linked conversation older than the newest 100, or a new chat the list does not show yet.
		const older = server('old', 'Old one')
		const current = [temp, server('c2', 'Two'), older, server('c1', 'One')]
		expect(
			mergeServerList(current, [server('c2', 'Two'), server('c1', 'One')], {
				activeKey: older.key,
			}).map(c => c.key),
		).toEqual([temp.key, `${APP}:c2`, `${APP}:old`, `${APP}:c1`])
		expect(mergeServerList([sentTemp], [server('c1', 'One')], { activeKey: sentTemp.key })).toEqual(
			[sentTemp, server('c1', 'One')],
		)
	})
	it('still drops an inactive conversation the server page lacks', () => {
		expect(
			mergeServerList([server('gone', 'Gone'), server('c1', 'One')], [server('c1', 'One')], {
				activeKey: `${APP}:c1`,
			}).map(c => c.difyId),
		).toEqual(['c1'])
	})
	it("keeps the client's label while the server still has Dify's placeholder name", () => {
		const localized: ConversationItem = { ...sentTemp, label: 'محادثة جديدة' }
		expect(mergeServerList([localized], [server('c9', DIFY_PLACEHOLDER_NAME)])[0].label).toBe(
			'محادثة جديدة',
		)
		expect(mergeServerList([localized], [server('c9', 'Tea time')])[0].label).toBe('Tea time')
	})
	it("shows the localized default label for Dify's placeholder name, also on a conversation the client never named", () => {
		const options = { defaultLabel: '新对话' }
		expect(mergeServerList([], [server('c9', DIFY_PLACEHOLDER_NAME)], options)[0].label).toBe(
			'新对话',
		)
		// A temp labelled before a language switch takes the current language's label.
		const localized: ConversationItem = { ...sentTemp, label: 'محادثة جديدة' }
		expect(
			mergeServerList([localized], [server('c9', DIFY_PLACEHOLDER_NAME)], options)[0],
		).toMatchObject({ key: sentTemp.key, label: '新对话' })
		expect(mergeServerList([], [server('c9', 'Tea time')], options)[0].label).toBe('Tea time')
	})
})

describe('regroup', () => {
	it('recomputes each group against now, so a list left open past midnight relabels', () => {
		const morning: ConversationItem = {
			key: `${APP}:c1`,
			label: 'One',
			difyId: 'c1',
			updatedAt: seconds(daysAgo(0, 9)),
			inputs: {},
			group: 'today',
		}
		const justAfterMidnight = local(2026, 9, 5, 0, 5)
		expect(regroup([morning], justAfterMidnight)).toEqual([{ ...morning, group: 'yesterday' }])
		expect(regroup([morning], NOW)).toEqual([morning])
	})
})
