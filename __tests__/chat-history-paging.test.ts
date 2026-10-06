import { describe, expect, it } from 'vitest'

import { nextPaging, prependLatestPage, prependOlder } from '@/components/chat/hooks/history-paging'

// Dify answers each GET /messages page oldest first (ADR-0017 note, MessageService.pagination_by_first_id
// with order "asc"); the e2e stub serves the same order.
const page = (ids: string[], hasMore: boolean) => ({
	data: ids.map(id => ({ id })),
	has_more: hasMore,
})

describe('nextPaging', () => {
	it('takes the first item of an oldest-first page as the first_id cursor', () => {
		expect(nextPaging(page(['m21', 'm22', 'm40'], true))).toEqual({ hasMore: true, firstId: 'm21' })
	})
	it('reports the end of the history from has_more', () => {
		expect(nextPaging(page(['m1', 'm2'], false))).toEqual({ hasMore: false, firstId: 'm1' })
	})
	it('keeps the previous cursor when a page comes back empty', () => {
		const previous = { hasMore: true, firstId: 'm21' }
		expect(nextPaging(page([], false), previous)).toEqual({ hasMore: false, firstId: 'm21' })
	})
	it('stops on an empty page even when has_more says more, so a click cannot repeat the same cursor', () => {
		const previous = { hasMore: true, firstId: 'm21' }
		expect(nextPaging(page([], true), previous)).toEqual({ hasMore: false, firstId: 'm21' })
	})
	it('never reports more pages without a cursor to ask for them', () => {
		expect(nextPaging(page([], true))).toEqual({ hasMore: false, firstId: undefined })
		expect(nextPaging(undefined)).toEqual({ hasMore: false, firstId: undefined })
	})
})

describe('prependOlder', () => {
	const info = (id: string) => ({ id, status: 'success' as const, message: id })

	it('puts the older page above the messages already shown, in its order', () => {
		expect(
			prependOlder([info('m21:q'), info('m21:a')], [info('m1:q'), info('m1:a')]).map(m => m.id),
		).toEqual(['m1:q', 'm1:a', 'm21:q', 'm21:a'])
	})
	it('skips messages that are already shown, so a repeated page adds nothing twice', () => {
		const shown = [info('m21:q'), info('m21:a')]
		expect(prependOlder(shown, [info('m21:q'), info('m21:a')])).toEqual(shown)
	})
})

describe('prependLatestPage', () => {
	const bubble = (id: string, messageId?: string) => ({
		id,
		status: 'success' as const,
		message: { ids: { messageId } },
	})

	it('puts a retried first page above what was sent since the failure, without the turns Dify already has', () => {
		// Sent after the failed load: a local user bubble (no Dify id) and its reply (Dify id m3).
		const sent = [bubble('msg_0'), bubble('msg_1', 'm3')]
		// The latest page holds the older turns and that same turn m3.
		const latest = [
			bubble('m2-user', 'm2'),
			bubble('m2-assistant', 'm2'),
			bubble('m3-user', 'm3'),
			bubble('m3-assistant', 'm3'),
		]
		expect(prependLatestPage(sent, latest).map(m => m.id)).toEqual([
			'm2-user',
			'm2-assistant',
			'msg_0',
			'msg_1',
		])
	})
	it('takes the whole page when nothing was sent meanwhile', () => {
		const latest = [bubble('m2-user', 'm2'), bubble('m2-assistant', 'm2')]
		expect(prependLatestPage([], latest)).toEqual(latest)
	})
})
