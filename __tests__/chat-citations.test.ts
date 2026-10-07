import { describe, expect, it } from 'vitest'

import { citationKey, citationTitle } from '@/components/chat/message/citations'
import type { RetrieverResource } from '@/lib/dify/types'

/** As streamed in message_end (OpenAPI example): no `id`, and `segment_position` may be missing too. */
const streamed = (fields: Partial<RetrieverResource>) =>
	({
		position: 1,
		document_name: 'iPhone List',
		segment_id: 'seg-1',
		...fields,
	}) as RetrieverResource

describe('citationKey', () => {
	it('keys a citation by its segment, else by its position in the list', () => {
		expect(citationKey(streamed({}))).toBe('seg-1')
		expect(citationKey(streamed({ segment_id: undefined, position: 3 }))).toBe('3')
	})
})

describe('citationTitle', () => {
	it('prefixes the segment position in the UI language digits when there is one', () => {
		expect(citationTitle(streamed({ segment_position: 12 }), 'en')).toBe('#12 iPhone List')
		expect(citationTitle(streamed({ segment_position: 12 }), 'ar')).toBe('#١٢ iPhone List')
	})
	it('shows the document name alone without a segment position', () => {
		expect(citationTitle(streamed({}), 'en')).toBe('iPhone List')
	})
})
