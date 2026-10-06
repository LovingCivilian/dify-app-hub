import type { IGetAppInfoResponse } from '@/lib/api'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

/**
 * The drawer's values (spec §5.4). Field names are array paths in IDifyAppItem's shape, so the values are a
 * partial item already; antd treats a dotted string as one key (`getNamePath = toArray(path)`), which is why the
 * old drawer rebuilt the object by hand. `feedbackText` is absent while the form-reply field is not rendered.
 */
export interface AppFormValues {
	requestConfig: { apiBase: string; apiKey: string }
	info: { mode: AppModeEnums }
	isEnabled: EIsEnabled
	inputParams: { enableUpdateAfterCvstStarts: boolean }
	extConfig: {
		conversation: { openingStatement: { displayMode: 'default' | 'always' } }
		annotation: { enabled: boolean }
	}
	answerForm: { enabled: boolean; feedbackText?: string }
}

export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	requestConfig: { apiBase: '', apiKey: '' },
	info: { mode: AppModeEnums.CHATBOT },
	isEnabled: EIsEnabled.enabled,
	inputParams: { enableUpdateAfterCvstStarts: false },
	extConfig: {
		conversation: { openingStatement: { displayMode: 'default' } },
		annotation: { enabled: false },
	},
	answerForm: { enabled: false, feedbackText: '' },
}

/** A saved app as the form's initial values; settings it lacks take the create defaults. */
export const toAppFormValues = (item: IDifyAppItem): AppFormValues => ({
	requestConfig: { apiBase: item.requestConfig.apiBase, apiKey: item.requestConfig.apiKey },
	info: { mode: item.info.mode ?? DEFAULT_APP_FORM_VALUES.info.mode },
	isEnabled: item.isEnabled ?? DEFAULT_APP_FORM_VALUES.isEnabled,
	inputParams: {
		enableUpdateAfterCvstStarts: item.inputParams?.enableUpdateAfterCvstStarts ?? false,
	},
	extConfig: {
		conversation: {
			openingStatement: {
				displayMode: item.extConfig?.conversation?.openingStatement?.displayMode ?? 'default',
			},
		},
		annotation: { enabled: item.extConfig?.annotation?.enabled ?? false },
	},
	answerForm: {
		enabled: item.answerForm?.enabled ?? false,
		feedbackText: item.answerForm?.feedbackText ?? '',
	},
})

/** The item to save: Dify's app info (its mode when it reports one, else the form's) plus the form's settings. */
export const fromAppFormValues = (
	values: AppFormValues,
	info: IGetAppInfoResponse,
): Omit<IDifyAppItem, 'id'> => ({
	info: { ...info, mode: info.mode || values.info.mode },
	isEnabled: values.isEnabled,
	requestConfig: { apiBase: values.requestConfig.apiBase, apiKey: values.requestConfig.apiKey },
	answerForm: {
		enabled: values.answerForm.enabled,
		feedbackText: values.answerForm.feedbackText ?? '',
	},
	inputParams: {
		enableUpdateAfterCvstStarts: values.inputParams.enableUpdateAfterCvstStarts,
	},
	extConfig: {
		conversation: {
			openingStatement: { displayMode: values.extConfig.conversation.openingStatement.displayMode },
		},
		annotation: { enabled: values.extConfig.annotation.enabled },
	},
})

/**
 * The 1/2 status on a Switch: Form.Item `getValueProps` + `normalize` (antd Form API; `valuePropName` is
 * ignored once `getValueProps` is set). A missing status counts as enabled, as dbAppToAppItem does.
 */
export const statusSwitchProps = {
	getValueProps: (value?: EIsEnabled) => ({ checked: value !== EIsEnabled.disabled }),
	normalize: (checked: boolean) => (checked ? EIsEnabled.enabled : EIsEnabled.disabled),
}
