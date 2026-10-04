/**
 * Hardening for ECharts options that come from a model answer (a fenced ```echarts block). ECharts does not
 * sanitise its input; its Security Guidelines (handbook, best-practices/security, "Security Model and Checklist")
 * list the options that take raw HTML, raw URLs, a download filename or a regular expression. Each is neutralised
 * here with documented options only; everything else (series, axes, data) passes through unchanged.
 */

type OptionObject = Record<string, unknown>

const isObject = (value: unknown): value is OptionObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** Component options may be one object or an array of them (`title`, `tooltip`, `toolbox`, `dataset`, `series`). */
const each = (value: unknown, visit: (item: OptionObject) => void) => {
	for (const item of Array.isArray(value) ? value : [value]) {
		if (isObject(item)) visit(item)
	}
}

/** Entries of a list ECharts walks with zrender's `each`, which also iterates a plain object's values. */
const entries = (value: unknown, visit: (item: OptionObject) => void) =>
	each(isObject(value) ? Object.values(value) : value, visit)

/**
 * `series-treemap.data.link` / `series-sunburst.data.link`: raw URLs opened on click, at any depth. Dropped from
 * every series: a timeline or media option's series has no `type` (it is merged by index into the base series),
 * and `link` is no data property of the other series types.
 */
const dropNodeLinks = (nodes: unknown) =>
	each(nodes, node => {
		delete node.link
		dropNodeLinks(node.children)
	})

/** `dataset.transform` filter `config.reg`: compiled into a RegExp with no limit (ReDoS), at any nesting. */
const dropRegs = (config: unknown) =>
	each(config, condition => {
		delete condition.reg
		for (const value of Object.values(condition)) dropRegs(value)
	})

/** One option unit: the root, `baseOption`, a timeline option or a media query option. */
const hardenUnit = (option: OptionObject) => {
	// tooltip.renderMode 'richText': the tooltip is drawn in the canvas, so `formatter` and `extraCssText`
	// never reach the DOM as HTML or CSS (option docs: tooltip.renderMode, tooltip.formatter).
	each(option.tooltip, tooltip => {
		tooltip.renderMode = 'richText'
	})
	// title.link / title.sublink: raw URLs passed to window.open on click.
	each(option.title, title => {
		delete title.link
		delete title.sublink
	})
	each(option.series, series => {
		dropNodeLinks(series.data)
		dropNodeLinks(series.levels)
	})
	// toolbox.feature.dataView renders `title`/`lang` as HTML; saveAsImage builds the filename from `name`/`type`
	// (or title[0].text) without validation.
	each(option.toolbox, toolbox => {
		each(toolbox.feature, feature => {
			delete feature.dataView
			delete feature.saveAsImage
		})
	})
	each(option.dataset, dataset => {
		each(dataset.transform, transform => dropRegs(transform.config))
	})
}

export function hardenEChartsOption(input: OptionObject): OptionObject {
	const option = structuredClone(input)
	hardenUnit(option)
	// The option manager also merges units from `baseOption`, the timeline's `options` and each `media[].option`
	// (option docs: timeline; tutorial: media query), so every one of them is hardened the same way.
	each(option.baseOption, hardenUnit)
	entries(option.options, hardenUnit)
	entries(option.media, media => each(media.option, hardenUnit))
	return option
}
