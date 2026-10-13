'use client'

import { theme } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * E3 (owner's pick): an asterisk on required fields and "(optional)" on the others. antd's built-in `requiredMark`
 * values give one or the other; its documented customize form, a render function `(label, { required })` (Form API,
 * `requiredMark`, since 5.9.0; demo "required-mark"), draws both, and antd then hides its own asterisk
 * (FormItemLabel: a function's mark type is `optional`, whose style drops the `::before` mark). The asterisk takes the
 * error colour token, as antd's own does, and is hidden from assistive technology like antd's CSS mark; "(optional)"
 * is read out.
 */
export const useRequiredMark = () => {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	return (label: ReactNode, { required }: { required: boolean }): ReactNode =>
		required ? (
			<>
				<span
					aria-hidden="true"
					style={{ color: token.colorError, marginInlineEnd: token.marginXXS }}
				>
					*
				</span>
				{label}
			</>
		) : (
			<>
				{label}
				<span style={{ color: token.colorTextDescription, marginInlineStart: token.marginXXS }}>
					{t('form.optional')}
				</span>
			</>
		)
}
