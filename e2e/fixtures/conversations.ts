import type { Locator } from '@playwright/test'

/**
 * X Conversations' creation button inside a conversation list. Its accessible name starts with its icon's label (antd's
 * PlusOutlined is `aria-label="plus"`), and it is matched exactly: a listed conversation still under the placeholder
 * name has an "Actions for New conversation" button, which a substring match finds too (Playwright `getByRole`'s
 * `name` is "case-insensitive and searches for a substring" unless `exact` is set).
 */
export const newConversationButton = (list: Locator) =>
	list.getByRole('button', { name: 'plus New conversation', exact: true })
