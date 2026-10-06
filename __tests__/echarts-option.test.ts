import { describe, expect, it } from 'vitest'

import { hardenEChartsOption } from '@/components/chat/message/markdown/echarts-option'

// ECharts Security Guidelines (handbook, best-practices/security) list the options that take raw HTML or raw URLs;
// a fenced ```echarts block is model output, so those options are neutralised before the chart sees them.
describe('hardenEChartsOption', () => {
	const series = [{ type: 'bar', data: [120, 200] }]

	it('renders tooltips in the canvas, so a string formatter is never HTML', () => {
		const single = hardenEChartsOption({
			tooltip: { formatter: '<img src=x onerror=alert(1)>' },
			series,
		})
		expect(single.tooltip).toEqual({
			formatter: '<img src=x onerror=alert(1)>',
			renderMode: 'richText',
		})

		const many = hardenEChartsOption({
			tooltip: [{ renderMode: 'html' }, { trigger: 'axis' }],
			series,
		})
		expect(many.tooltip).toEqual([
			{ renderMode: 'richText' },
			{ trigger: 'axis', renderMode: 'richText' },
		])
	})

	it('drops the raw-URL links of titles and of treemap and sunburst nodes', () => {
		const hardened = hardenEChartsOption({
			title: [
				{
					text: 'Sales',
					link: 'javascript:alert(1)',
					sublink: 'https://example.com',
					subtext: 'Q2',
				},
			],
			series: [
				{
					type: 'treemap',
					nodeClick: 'link',
					data: [
						{
							name: 'a',
							value: 1,
							link: 'javascript:1',
							children: [{ name: 'b', value: 2, link: 'javascript:2' }],
						},
					],
				},
				{
					type: 'sunburst',
					nodeClick: 'link',
					levels: [{ link: 'javascript:3' }],
					data: [{ name: 'c', value: 3, link: 'javascript:4' }],
				},
			],
		})
		expect(hardened.title).toEqual([{ text: 'Sales', subtext: 'Q2' }])
		expect(JSON.stringify(hardened.series)).not.toContain('javascript:')
		expect(hardened.series).toEqual([
			{
				type: 'treemap',
				nodeClick: 'link',
				data: [{ name: 'a', value: 1, children: [{ name: 'b', value: 2 }] }],
			},
			{ type: 'sunburst', nodeClick: 'link', levels: [{}], data: [{ name: 'c', value: 3 }] },
		])
	})

	it('removes the toolbox features that write HTML or a download filename, keeping the others', () => {
		const hardened = hardenEChartsOption({
			toolbox: {
				feature: {
					dataView: { lang: ['<b onmouseover=alert(1)>x</b>'] },
					saveAsImage: { type: 'svg"' },
					restore: {},
				},
			},
			series,
		})
		expect(hardened.toolbox).toEqual({ feature: { restore: {} } })
	})

	it('drops regular expressions from dataset filter transforms (ReDoS)', () => {
		const hardened = hardenEChartsOption({
			dataset: [
				{ source: [[1], [2]] },
				{
					transform: {
						type: 'filter',
						config: {
							and: [
								{ dimension: 0, reg: '^(a+)+$' },
								{ dimension: 0, '>': 1 },
							],
						},
					},
				},
			],
			series,
		})
		expect(hardened.dataset).toEqual([
			{ source: [[1], [2]] },
			{
				transform: {
					type: 'filter',
					config: { and: [{ dimension: 0 }, { dimension: 0, '>': 1 }] },
				},
			},
		])
	})

	// ECharts' option manager also reads units from `baseOption`, timeline `options[]` and `media[].option`
	// (option docs: timeline, media query tutorial); each is merged into what the tooltip and title code see.
	const unsafeUnit = () => ({
		tooltip: { formatter: '<img src=x onerror=alert(1)>' },
		title: { text: 'T', link: 'javascript:alert(1)', sublink: 'javascript:alert(2)' },
		toolbox: { feature: { dataView: {}, restore: {} } },
		// A switchable option's series carries no `type` (it is merged by index into the base series).
		series: [{ data: [{ name: 'n', value: 1, link: 'javascript:alert(3)' }] }],
	})
	const safeUnit = {
		tooltip: { formatter: '<img src=x onerror=alert(1)>', renderMode: 'richText' },
		title: { text: 'T' },
		toolbox: { feature: { restore: {} } },
		series: [{ data: [{ name: 'n', value: 1 }] }],
	}

	it('hardens a declared baseOption', () => {
		const input = { baseOption: unsafeUnit(), options: [] }
		const hardened = hardenEChartsOption(input)
		expect(hardened.baseOption).toEqual(safeUnit)
		expect(input.baseOption).toEqual(unsafeUnit())
	})

	it('hardens every timeline option, in an array or keyed by index', () => {
		const input = {
			timeline: { data: ['2025', '2026'] },
			series,
			options: [unsafeUnit(), unsafeUnit()],
		}
		const hardened = hardenEChartsOption(input)
		expect(hardened.options).toEqual([safeUnit, safeUnit])
		expect(input.options).toEqual([unsafeUnit(), unsafeUnit()])
		expect(hardenEChartsOption({ series, options: { 0: unsafeUnit() } }).options).toEqual({
			0: safeUnit,
		})
	})

	it('hardens every media query option, the default one included', () => {
		const input = {
			series,
			media: [{ query: { maxWidth: 500 }, option: unsafeUnit() }, { option: unsafeUnit() }],
		}
		const hardened = hardenEChartsOption(input)
		expect(hardened.media).toEqual([
			{ query: { maxWidth: 500 }, option: safeUnit },
			{ option: safeUnit },
		])
		expect(input.media[0].option).toEqual(unsafeUnit())
	})

	it('keeps the series data and leaves the parsed input untouched', () => {
		const input = {
			xAxis: { type: 'category', data: ['Mon', 'Tue'] },
			title: { text: 'T', link: 'https://example.com' },
			series,
		}
		const hardened = hardenEChartsOption(input)
		expect(hardened.series).toEqual(series)
		expect(hardened.xAxis).toEqual(input.xAxis)
		expect(input.title).toEqual({ text: 'T', link: 'https://example.com' })
	})
})
