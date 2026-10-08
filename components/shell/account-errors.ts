import type { ActionErrorCode } from '@/lib/action-result'

/** The change-password form's failure text (charter §4.5); a wrong current password is shown on its field instead. */
export const changePasswordFailureKey = (code: ActionErrorCode) =>
	code === 'unauthorized'
		? ('common.session_expired' as const)
		: ('account.change_password_failed' as const)
