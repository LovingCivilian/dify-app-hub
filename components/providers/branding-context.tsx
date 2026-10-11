'use client'

import { createContext, useContext } from 'react'

import type { ShellBranding } from '@/lib/settings/branding-rules'

const BrandingContext = createContext<ShellBranding | null>(null)

/**
 * The brand from the root layout (settings spec §4.6), as the session and the theme travel (ADR-0020). Rendered as
 * `<BrandingContext value>`: react.dev `createContext` ("Starting in React 19, you can render `<SomeContext>` as a
 * provider"; `SomeContext.Provider` is the legacy form).
 */
export function BrandingProvider({
	value,
	children,
}: {
	value: ShellBranding
	children: React.ReactNode
}) {
	return <BrandingContext value={value}>{children}</BrandingContext>
}

export const useBranding = (): ShellBranding => {
	const value = useContext(BrandingContext)
	if (!value) throw new Error('useBranding is used outside BrandingProvider')
	return value
}
