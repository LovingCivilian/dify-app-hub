import type { HumanInputForm } from '@/lib/dify/types'

import type { HumanInputState } from '../provider/message'

/**
 * The form as GET /form/human_input/{form_token} defines it (endpoint map §1.5), over what the stream or the
 * history carried: the select options, file restrictions and defaults are documented only there (ADR-0017
 * note of 2026-10-05). Token, run and node stay the message's.
 */
export const applyFormDefinition = (
	humanInput: HumanInputState,
	form: HumanInputForm,
): HumanInputState => ({
	...humanInput,
	formContent: form.form_content,
	inputs: form.inputs,
	actions: form.user_actions,
	defaults: form.resolved_default_values,
	expiresAt: form.expiration_time,
})
