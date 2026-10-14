import 'server-only'

import { Cron } from 'croner'

import { purgeDeletedConversations } from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'

/*
 * The daily purge of deleted conversations (Part 2 spec §3.4; plan call P13), registered beside the directory sync in
 * instrumentation.ts the way lib/directory/schedule.ts registers it: one croner job per process, kept on globalThis so a
 * development reload does not start a second one (Rallly's guard, cited there).
 */

/** Every day at 03:00 in the server's zone (croner reads a five-field pattern in `mode: '5-part'`, croner.d.ts). */
export const PURGE_SCHEDULE = '0 3 * * *'

const globalForPurge = globalThis as unknown as { aiAppHubConversationPurge?: Cron }

/** One run: conversations deleted more than PURGE_AFTER_DAYS ago go, with their runs and messages (cascade); the count is logged. */
const runPurge = async (): Promise<void> => {
	const purged = await purgeDeletedConversations()
	console.info('conversationPurge:', { purged })
}

/**
 * Starts the job once per process. croner's README, Options: `protect` "Will block new triggers as long as an old trigger
 * is in progress", `unref` "allows the process to exit even if a cron job is running", and `catch` receives a run's
 * error, logged here by logActionError (decision g of B3b: a database error by its name and code). croner calls the job
 * with itself and its context, so the purge is wrapped and takes no argument from it.
 */
export function startPurgeSchedule(): void {
	if (globalForPurge.aiAppHubConversationPurge) return
	globalForPurge.aiAppHubConversationPurge = new Cron(
		PURGE_SCHEDULE,
		{
			mode: '5-part',
			protect: true,
			unref: true,
			catch: (error: unknown) => logActionError(error, 'conversationPurge'),
		},
		() => runPurge(),
	)
}
