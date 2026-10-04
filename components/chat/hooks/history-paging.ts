/** The part of a GET /messages answer that paging reads. */
export interface HistoryPage {
	data?: { id: string }[] | null
	has_more?: boolean
}

/** Where "load earlier" continues: `first_id` for the next, older page. */
export interface HistoryPaging {
	hasMore: boolean
	firstId?: string
}

/**
 * Dify answers each GET /messages page oldest first (ADR-0017 note: `pagination_by_first_id` with
 * order "asc"), and `first_id` pages backward from the message it names. The cursor for the next,
 * older page is therefore the page's FIRST item; paging from the last one, the newest, would bring
 * back most of the page just shown. An empty page keeps the previous cursor and ends paging even if
 * `has_more` says otherwise: asking again with the same cursor would return the same empty page.
 */
export const nextPaging = (
	page: HistoryPage | undefined,
	previous?: HistoryPaging,
): HistoryPaging => {
	const items = page?.data ?? []
	return {
		hasMore: Boolean(page?.has_more) && items.length > 0,
		firstId: items[0]?.id ?? previous?.firstId,
	}
}

/** An older page goes above the messages already shown; ids already present are not added twice. */
export const prependOlder = <T extends { id: string | number }>(current: T[], older: T[]): T[] => {
	const shown = new Set(current.map(m => m.id))
	return [...older.filter(m => !shown.has(m.id)), ...current]
}
