import { expect, test } from '@playwright/test'

/** The three list pages share one header (cosmetic sweep 1, item 4): a level-4 title with a subtitle under it. */
const PAGES = [
	{ path: '/apps', title: 'Apps', subtitle: 'Choose an app to start a conversation' },
	{
		path: '/app-management',
		title: 'App configuration',
		subtitle: 'Manage the Dify apps published in the hub',
	},
	{ path: '/user-management', title: 'User management', subtitle: 'Manage user accounts' },
]

test('the apps, app management and user management pages share one header: title, subtitle below it, same left edge', async ({
	page,
}) => {
	const lefts: number[] = []
	for (const { path, title, subtitle } of PAGES) {
		await page.goto(path)
		const heading = page.getByRole('heading', { name: title, level: 4, exact: true })
		await expect(heading).toBeVisible()
		const text = page.getByText(subtitle, { exact: true })
		await expect(text).toBeVisible()
		const [headingBox, subtitleBox] = await Promise.all([heading.boundingBox(), text.boundingBox()])
		// The subtitle starts where the title ends and shares its left edge.
		expect(subtitleBox!.y).toBeGreaterThanOrEqual(headingBox!.y + headingBox!.height)
		expect(Math.round(subtitleBox!.x)).toBe(Math.round(headingBox!.x))
		lefts.push(Math.round(headingBox!.x))
	}
	// One left edge for the three titles (the same page padding on every page).
	expect(new Set(lefts).size).toBe(1)
})
