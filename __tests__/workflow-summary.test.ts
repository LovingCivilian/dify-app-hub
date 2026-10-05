import { describe, expect, it } from 'vitest'

import { formatCount, formatSeconds, runSummary } from '@/components/chat/message/workflow-summary'
import i18n from '@/libs/i18n'

const LATIN_DIGIT = /[0-9]/

describe('runSummary', () => {
	it('sums elapsed time and tokens over the nodes', () => {
		expect(
			runSummary({
				status: 'finished',
				nodes: [
					{
						id: '1',
						nodeId: 'a',
						type: 'start',
						title: 'Start',
						status: 'success',
						elapsedTime: 0.25,
						totalTokens: 0,
					},
					{
						id: '2',
						nodeId: 'b',
						type: 'llm',
						title: 'Answer',
						status: 'success',
						elapsedTime: 1.5,
						totalTokens: 42,
					},
					{ id: '3', nodeId: 'c', type: 'end', title: 'End', status: 'running' },
				],
			}),
		).toEqual({ nodes: 3, seconds: 1.75, tokens: 42 })
	})

	it('rounds the summed time to milliseconds so float noise does not leak into the header', () => {
		const node = { nodeId: 'n', type: 'code', title: 'Code', status: 'success' as const }
		expect(
			runSummary({
				status: 'finished',
				nodes: [
					{ ...node, id: '1', elapsedTime: 0.1 },
					{ ...node, id: '2', elapsedTime: 0.2 },
				],
			}).seconds,
		).toBe(0.3)
	})
})

describe('formatSeconds', () => {
	it('renders three decimals and nothing for a missing value', () => {
		expect(formatSeconds(0.4219, 'en')).toBe('0.422')
		expect(formatSeconds(1.5, 'en')).toBe('1.500')
		expect(formatSeconds(undefined, 'en')).toBe('')
	})

	it('treats a JSON null like a missing value instead of printing 0.000', () => {
		expect(formatSeconds(null, 'en')).toBe('')
	})

	it('takes the number of decimals as an argument', () => {
		expect(formatSeconds(1.754, 'en', 2)).toBe('1.75')
	})

	it('falls back to English for a missing or unknown language', () => {
		expect(formatSeconds(0.4219)).toBe('0.422')
		expect(formatSeconds(0.4219, 'fr')).toBe('0.422')
	})

	it('writes Arabic with Arabic-Indic digits and the Arabic decimal separator', () => {
		const text = formatSeconds(0.4219, 'ar')
		expect(text).toBe('٠٫٤٢٢')
		expect(text).not.toMatch(LATIN_DIGIT)
	})

	it('reads as seconds once the workflow.seconds unit is applied, in each language', () => {
		const unit = (language: string) =>
			i18n.getFixedT(language)('workflow.seconds', { value: formatSeconds(0.4219, language) })
		expect(unit('en')).toBe('0.422 s')
		expect(unit('zh')).toBe('0.422 秒')
		expect(unit('ar')).toBe('٠٫٤٢٢ ث')
	})
})

describe('formatCount', () => {
	it('groups digits for the language', () => {
		expect(formatCount(12345, 'en')).toBe('12,345')
		expect(formatCount(12345)).toBe('12,345')
		expect(formatCount(12345, 'zh')).toBe('12,345')
	})

	it('writes Arabic counts with Arabic-Indic digits', () => {
		const text = formatCount(12345, 'ar')
		expect(text).toBe('١٢٬٣٤٥')
		expect(text).not.toMatch(LATIN_DIGIT)
	})
})

describe('workflow.summary and workflow.tokens', () => {
	it('show no Latin digit in Arabic', () => {
		const t = i18n.getFixedT('ar')
		const summary = t('workflow.summary', {
			nodes: formatCount(3, 'ar'),
			seconds: formatSeconds(1.75, 'ar', 2),
			tokens: formatCount(42, 'ar'),
		})
		expect(summary).toBe('العقد: ٣ · المدة: ١٫٧٥ ث · الرموز: ٤٢')
		expect(t('workflow.tokens', { value: formatCount(1200, 'ar') })).toBe('الرموز: ١٬٢٠٠')
	})

	it('read as count-neutral labels in English, so one node needs no plural form', () => {
		const t = i18n.getFixedT('en')
		expect(
			t('workflow.summary', {
				nodes: formatCount(3, 'en'),
				seconds: formatSeconds(1.75, 'en', 2),
				tokens: formatCount(1042, 'en'),
			}),
		).toBe('Nodes: 3 · Time: 1.75 s · Tokens: 1,042')
		expect(t('workflow.tokens', { value: formatCount(12, 'en') })).toBe('Tokens: 12')
		expect(
			t('workflow.summary', {
				nodes: formatCount(1, 'en'),
				seconds: formatSeconds(0.5, 'en', 2),
				tokens: formatCount(0, 'en'),
			}),
		).toBe('Nodes: 1 · Time: 0.50 s · Tokens: 0')
	})
})
