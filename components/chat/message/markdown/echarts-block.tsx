'use client'

import { Alert, theme } from 'antd'
import ReactEcharts from 'echarts-for-react'
import { Component, type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeContext } from '@/lib/theme'

import { hardenEChartsOption } from './echarts-option'

interface BoundaryProps {
	fallback: ReactNode
	children: ReactNode
}

/** ECharts can throw while rendering an option it cannot draw (an unregistered map, say); keep that inside the block. */
class ChartErrorBoundary extends Component<BoundaryProps, { hasError: boolean }> {
	state = { hasError: false }

	static getDerivedStateFromError() {
		return { hasError: true }
	}

	render() {
		return this.state.hasError ? this.props.fallback : this.props.children
	}
}

/** The fence's JSON as an option object, hardened (`echarts-option.ts`); undefined when it is not one. */
const parseOption = (code: string): Record<string, unknown> | undefined => {
	try {
		const option: unknown = JSON.parse(code)
		return option && typeof option === 'object' && !Array.isArray(option)
			? hardenEChartsOption(option as Record<string, unknown>)
			: undefined
	} catch {
		return undefined
	}
}

/** ```echarts fenced blocks: the fence holds an ECharts option as JSON. */
export default function EchartsBlock({ code }: { code: string }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { isDark } = useThemeContext()
	const option = useMemo(() => parseOption(code), [code])

	if (!option) {
		return (
			<Alert
				type="warning"
				title={t('message.echarts_invalid')}
			/>
		)
	}
	return (
		<ChartErrorBoundary
			fallback={
				<Alert
					type="warning"
					title={t('message.echarts_failed')}
				/>
			}
		>
			<ReactEcharts
				option={option}
				// echarts-for-react `theme`: ECharts registers a built-in 'dark' theme.
				theme={isDark ? 'dark' : undefined}
				style={{ minHeight: token.controlHeight * 10 }}
			/>
		</ChartErrorBoundary>
	)
}
