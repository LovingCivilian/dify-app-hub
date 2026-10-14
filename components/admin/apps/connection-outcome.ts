import type { TFunction } from 'i18next'

import type { ConnectionTestOutcome } from '@/app/(admin)/app-management/actions'
import { typeName } from '@/components/provider-ui/registry'
import type { ActionResult } from '@/lib/action-result'
import type { ProviderId } from '@/lib/providers/ids'

import { appErrorKey } from './app-errors'

/** What the Alert under Test connection shows (E7): its type, its title and its description. */
export interface ConnectionOutcome {
	type: 'success' | 'warning' | 'error'
	title: string
	description: string
}

/**
 * The test's result in words (spec §4.2): reachable is success, another type a warning that does not block the save,
 * and each failure an error with words of its own (Plan decision g); any other failure says why the test did not run.
 * An `invalid_input` carries field codes only (review B7), so the text is the generic one, never a zod message.
 */
export const connectionOutcome = (
	t: TFunction,
	provider: ProviderId,
	result: ActionResult<ConnectionTestOutcome>,
	chosenType?: string,
): ConnectionOutcome => {
	if (result.ok) {
		if (result.data.outcome === 'reachable')
			return {
				type: 'success',
				title: t('connection_test.reachable_title'),
				description: t('connection_test.reachable_description'),
			}
		if (result.data.outcome === 'ran_on_invalid_input')
			return {
				type: 'warning',
				title: t('connection_test.ran_on_invalid_input_title'),
				description: t('connection_test.ran_on_invalid_input_description'),
			}
		return {
			type: 'warning',
			title: t('connection_test.type_mismatch_title'),
			description: t('connection_test.type_mismatch_description', {
				reported: typeName(t, provider, result.data.reported),
				chosen: chosenType ? typeName(t, provider, chosenType) : '',
			}),
		}
	}
	switch (result.code) {
		case 'provider_key_refused':
			return {
				type: 'error',
				title: t('connection_test.key_refused_title'),
				description: t('connection_test.key_refused_description'),
			}
		case 'provider_unreachable':
			return {
				type: 'error',
				title: t('connection_test.unreachable_title'),
				description: t('connection_test.unreachable_description'),
			}
		case 'provider_error':
			return {
				type: 'error',
				title: t('connection_test.upstream_error_title'),
				description: t('connection_test.upstream_error_description'),
			}
		case 'provider_agent_not_found':
			return {
				type: 'error',
				title: t('connection_test.agent_not_found_title'),
				description: t('connection_test.agent_not_found_description'),
			}
		default:
			return {
				type: 'error',
				title: t('connection_test.failed_title'),
				description: t(appErrorKey(result.code, 'save')),
			}
	}
}
