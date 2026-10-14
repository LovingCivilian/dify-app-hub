import type { Interrupt } from '@ag-ui/core'
import { useEffect, useState } from 'react'

import { nextExpiry } from '../answers'

/** setTimeout's longest delay (MDN "setTimeout()", Maximum delay value: a signed 32-bit integer, about 24.8 days). */
const MAX_DELAY_MS = 2_147_483_647

/**
 * P14: now, renewed when the next `expiresAt` among the interrupts passes, so an interrupt's card turns expired on time.
 * The time is state set from a timer in an Effect, never read while rendering (React, the `purity` lint: "I need to show
 * the current time"); the cleanup clears the timer when the next expiry or the time changes (React "Synchronizing with
 * Effects"). An expiry further away than setTimeout can wait is reached in steps of its longest delay; one already past
 * fires at once (MDN: "Negative values behave the same as 0").
 */
export const useExpiryClock = (interrupts: readonly Interrupt[]): Date => {
	const [now, setNow] = useState(() => new Date())
	const next = nextExpiry(interrupts, now)
	useEffect(() => {
		if (next === null) return
		const timer = setTimeout(() => setNow(new Date()), Math.min(next - Date.now(), MAX_DELAY_MS))
		return () => clearTimeout(timer)
	}, [next, now])
	return now
}
