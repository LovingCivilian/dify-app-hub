import { FormInstance } from 'antd'

import { CHAT_MODES, RUN_MODES, type AppMode } from '@/lib/dify/types'

/**
 * 校验表单, 如果校验未通过则生成错误信息
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

/**
 * 填充文件的完整 URL，返回全路径
 * @param url 原始 URL
 * @param apiBase 应用的 API Base
 * @returns 完整的文件 URL
 */
export const completeFileUrl = (url: string, apiBase: string) => {
	let result = url
	if (!url) {
		return ''
	}
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		const apiDomain = apiBase.slice(0, apiBase.lastIndexOf('/v1'))
		result = `${apiDomain}${url}`
	}
	return result
}

/** Chat-like apps (chat, agent-chat, advanced-chat, agent): the conversation view. */
export const isChatLikeApp = (mode: AppMode | null) => mode !== null && CHAT_MODES.includes(mode)

/** Run-like apps (workflow, completion): the runner view. */
export const isWorkflowLikeApp = (mode: AppMode | null) => mode !== null && RUN_MODES.includes(mode)
