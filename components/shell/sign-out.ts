import { signOut } from 'next-auth/react'

/**
 * Sign out and return to the login page with a full page load: next-auth's default (`redirect` true) sets
 * `window.location.href` to the callback URL (next-auth client API, signOut "Specifying a callbackUrl").
 * The chat keeps per-conversation state at module level (provider cache, history paging, x-sdk's stores),
 * so a client navigation would hand it to the next account; a fresh document starts without it (ADR-0017).
 */
export const logout = () => signOut({ callbackUrl: '/login' })

/**
 * After a password change every session is revoked, this one included (charter §4.2): signing out clears the
 * cookie and lands on the login page, which shows the notice from the query flag.
 */
export const signOutAfterPasswordChange = () =>
	signOut({ callbackUrl: '/login?notice=password-changed' })
