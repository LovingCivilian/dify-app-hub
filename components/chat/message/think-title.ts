import type { TFunction } from 'i18next'

import { formatSeconds } from './workflow-summary'

/**
 * The title of a reasoning block (X Think `title`): the running time while it streams, the time it took
 * once that is known, else the bare "finished" text. Seconds in the UI language's digits (ADR-0005);
 * `language` is `i18n.resolvedLanguage`.
 */
export const thinkTitle = (
	t: TFunction,
	loading: boolean,
	seconds: number | undefined,
	language?: string,
) => {
	if (loading)
		return t('message.think.in_progress', { seconds: formatSeconds(seconds ?? 0, language, 1) })
	return seconds === undefined
		? t('message.think.done')
		: t('message.think.done_with_time', { seconds: formatSeconds(seconds, language, 1) })
}
