import type { IRetrieverResource } from '@/lib/api'

import { formatCount } from './workflow-summary'

/**
 * A citation's key in the list. Streamed citations (message_end) have no `id`, only the stored ones of
 * GET /messages do, so the segment id is used, else the citation's position.
 */
export const citationKey = (citation: IRetrieverResource) =>
	citation.segment_id || String(citation.position)

/** "#<segment position> <document>", the position in the UI language's digits (ADR-0005), when it is known. */
export const citationTitle = (citation: IRetrieverResource, language?: string) =>
	citation.segment_position == null
		? citation.document_name
		: `#${formatCount(citation.segment_position, language)} ${citation.document_name}`
