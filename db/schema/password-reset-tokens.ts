import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamptz } from './columns'

/** The inherited reset links (ADR-0024 left them as upstream wrote them); `user_id` has no foreign key and its own index. */
export const passwordResetTokens = pgTable(
	'password_reset_tokens',
	{
		id: uuid().primaryKey(),
		userId: uuid('user_id').notNull(),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamptz('expires_at').notNull(),
		usedAt: timestamptz('used_at'),
		createdAt: timestamptz('created_at').notNull(),
	},
	table => [
		index('password_reset_tokens_user_id_idx').on(table.userId),
		index('password_reset_tokens_token_hash_idx').on(table.tokenHash),
	],
)
