import { expect, type Locator } from '@playwright/test'

/**
 * Waits until a drawer's open motion has ended, before a test closes it to watch the close motion. antd removes a
 * drawer at once, with no close motion and no `afterOpenChange(false)`, when it is closed before rc-motion has
 * ended the open motion (`@rc-component/drawer` `animatedVisible`), and that end can come at antd's
 * `motionDeadline` (500 ms), after the panel already looks still. rc-motion takes its motion classes off the
 * panel wrapper, the dialog's parent, when the motion ends; no role or name changes at that moment.
 */
export const drawerOpened = async (dialog: Locator) => {
	const wrapper = dialog.locator('xpath=..')
	await expect(wrapper).toHaveClass(/\bant-drawer-content-wrapper\b/)
	await expect(wrapper).not.toHaveClass(/-motion-/)
}
