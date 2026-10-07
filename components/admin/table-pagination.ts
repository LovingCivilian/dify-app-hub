import type { TablePaginationConfig } from 'antd'

/**
 * The admin tables' pagination (cosmetic sweep 1, item 6): items per page, the quick jumper (antd renders
 * it above one page) and the total, one config for every table so they do not drift apart again.
 */
export const tablePagination = (showTotal: (total: number) => string): TablePaginationConfig => ({
	showSizeChanger: true,
	showQuickJumper: true,
	showTotal,
})
