import { FormInstance } from 'antd'

import { CHAT_MODES, RUN_MODES, type AppMode } from '@/lib/dify/types'

/**
 * Validates the form; when validation fails, builds the error message
 */
export const validateAndGenErrMsgs = (
	form: FormInstance<Record<string, unknown>>,
): Promise<{ isSuccess: boolean; errMsgs: string }> => {
	return new Promise((resolve, _reject) => {
		form
			.validateFields()
			.then(() => {
				resolve({
					isSuccess: true,
					errMsgs: '',
				})
			})
			.catch(error => {
				console.error('Form validation failed', error)
				const errMsgs = (
					error as {
						errorFields: {
							errors: string[]
						}[]
					}
				).errorFields
					.map(item => {
						return item.errors?.join(',') || ''
					})
					.filter(Boolean)
					.join(',')
				resolve({
					isSuccess: false,
					errMsgs,
				})
			})
	})
}

/** Chat-like apps (chat, agent-chat, advanced-chat, agent): the conversation view. */
export const isChatLikeApp = (mode: AppMode | null) => mode !== null && CHAT_MODES.includes(mode)

/** Run-like apps (workflow, completion): the runner view. */
export const isWorkflowLikeApp = (mode: AppMode | null) => mode !== null && RUN_MODES.includes(mode)
