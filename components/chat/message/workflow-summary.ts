import { intlLocale } from '@/libs/format-date'

import type { WorkflowState } from '../provider/message'

/** Node count, summed elapsed seconds (rounded to milliseconds) and summed tokens of a run. */
export const runSummary = (workflow: WorkflowState) => ({
	nodes: workflow.nodes.length,
	seconds:
		Math.round(workflow.nodes.reduce((sum, n) => sum + (n.elapsedTime ?? 0), 0) * 1000) / 1000,
	tokens: workflow.nodes.reduce((sum, n) => sum + (n.totalTokens ?? 0), 0),
})

// One formatter per locale and digit count: the logs re-render on every stream event and format a
// handful of numbers each time, and constructing an Intl.NumberFormat is the costly part (MDN advises
// creating it once when formatting many numbers).
const formatters = new Map<string, Intl.NumberFormat>()

const numberFormat = (language?: string, fractionDigits?: number) => {
	const locale = intlLocale(language)
	const key = `${locale}|${fractionDigits ?? ''}`
	let formatter = formatters.get(key)
	if (!formatter) {
		formatter = new Intl.NumberFormat(
			locale,
			fractionDigits === undefined
				? undefined
				: { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits },
		)
		formatters.set(key, formatter)
	}
	return formatter
}

/** A whole number in the UI language's digits and grouping; `language` is `i18n.resolvedLanguage`. */
export const formatCount = (value: number, language?: string) =>
	numberFormat(language).format(value)

/**
 * Seconds as a fixed number of decimals in the UI language's digits (Arabic-Indic for `ar`, ADR-0005);
 * '' for a missing value, including the `null` Dify's JSON can carry. The unit is not part of the
 * result: the caller applies the translated `workflow.seconds` ("{{value}} s"), because `Intl`'s own
 * unit style spells English as "sec".
 */
export const formatSeconds = (seconds?: number | null, language?: string, fractionDigits = 3) =>
	seconds == null ? '' : numberFormat(language, fractionDigits).format(seconds)

/** Any number with a fixed count of decimals in the UI language's digits (a citation's score). */
export const formatDecimal = (
	value: number,
	language: string | undefined,
	fractionDigits: number,
) => numberFormat(language, fractionDigits).format(value)
