import { expect, test } from '@playwright/test'

/** The list pages share one header (cosmetic sweep 1, item 4): a level-4 title with a subtitle under it. */
const PAGES = [
	{ path: '/apps', title: 'Apps', subtitle: 'Choose an app to start a conversation' },
	{
		path: '/app-management',
		title: 'App configuration',
		subtitle: 'Manage the Dify apps published in the hub',
	},
	{ path: '/user-management', title: 'User management', subtitle: 'Manage user accounts' },
	{
		path: '/group-management',
		title: 'Group management',
		subtitle: 'Group accounts to give them apps together',
	},
]

test('the apps, app management, user management and group management pages share one header: title, subtitle below it, same inset', async ({
	page,
}) => {
	const insets: number[] = []
	for (const { path, title, subtitle } of PAGES) {
		await page.goto(path)
		const heading = page.getByRole('heading', { name: title, level: 4, exact: true })
		await expect(heading).toBeVisible()
		const text = page.getByText(subtitle, { exact: true })
		await expect(text).toBeVisible()
		const [headingBox, subtitleBox, regionBox] = await Promise.all([
			heading.boundingBox(),
			text.boundingBox(),
			// The shell's content region (Layout.Content, a <main>): right of the admin sidebar from md up.
			page.getByRole('main').boundingBox(),
		])
		// The subtitle starts where the title ends and shares its left edge.
		expect(subtitleBox!.y).toBeGreaterThanOrEqual(headingBox!.y + headingBox!.height)
		expect(Math.round(subtitleBox!.x)).toBe(Math.round(headingBox!.x))
		insets.push(Math.round(headingBox!.x - regionBox!.x))
	}
	// One inset from the content region's left edge for the titles (the same page padding on every page).
	expect(new Set(insets).size).toBe(1)
})
