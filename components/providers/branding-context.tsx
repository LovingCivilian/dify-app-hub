'use client'

import { createContext, useContext } from 'react'

import type { BrandingView } from '@/lib/settings/branding-rules'

const BrandingContext = createContext<BrandingView | null>(null)

/**
 * The brand from the root layout (settings spec §4.6), as the session and the theme travel (ADR-0020). Rendered as
 * `<BrandingContext value>`: react.dev `createContext` ("Starting in React 19, you can render `<SomeContext>` as a
 * provider"; `SomeContext.Provider` is the legacy form).
 */
export function BrandingProvider({
	value,
	children,
}: {
	value: BrandingView
	children: React.ReactNode
}) {
	return <BrandingContext value={value}>{children}</BrandingContext>
}

export const useBranding = (): BrandingView => {
	const value = useContext(BrandingContext)
	if (!value) throw new Error('useBranding is used outside BrandingProvider')
	return value
}
