import { expect, type Locator } from '@playwright/test'

/**
 * Waits until a server-rendered page has hydrated, before a test's first click. A click that lands before React has
 * attached its handlers does nothing (Playwright docs, "Navigations > Hydration"); seen on the mobile project, where
 * Edit opened no drawer. The fix those docs name is product-side, interactive controls disabled until hydration;
 * that is a pattern change for the owner and is recorded as a follow-up. Until then this is a test-side wait on a
 * signal only hydration produces, which the caller passes in: ClientDateTime renders its text only after its effect
 * runs (react.dev, hydrateRoot: two-pass rendering), so a date in the table marks a hydrated table. The signal must
 * sit in the same client component as the control clicked (Suspense boundaries hydrate on their own).
 */
export const waitForHydration = async (signal: Locator) => {
	await expect(signal).not.toContainText(/^\s*$/)
}
