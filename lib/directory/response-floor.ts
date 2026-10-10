import 'server-only'

import { setTimeout as sleepFor } from 'node:timers/promises'

/**
 * A response-time floor for refused directory sign-ins (decision t), the shape of Authelia's TimingAttackDelay: the
 * moving average of the last ten successful sign-ins, one second until there is one, never under 250 ms, plus 0–85 ms of
 * jitter. Kept in the process's memory; each container learns its own.
 */
export class ResponseFloor {
	private readonly samples: number[] = []
	private readonly random: () => number
	private readonly sleep: (ms: number) => Promise<unknown>
	private readonly now: () => number

	constructor(
		options: {
			random?: () => number
			sleep?: (ms: number) => Promise<unknown>
			now?: () => number
		} = {},
	) {
		this.random = options.random ?? Math.random
		this.sleep = options.sleep ?? (ms => sleepFor(ms))
		this.now = options.now ?? (() => performance.now())
	}

	/** A successful sign-in's duration in milliseconds. */
	record(ms: number): void {
		this.samples.push(ms)
		if (this.samples.length > 10) this.samples.shift()
	}

	floorMs(): number {
		const average = this.samples.length
			? this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length
			: 1_000
		return Math.max(average, 250)
	}

	/** Waits until the floor plus jitter has passed since `startedAt` (a `performance.now()` reading). */
	async pad(startedAt: number): Promise<void> {
		const wait = this.floorMs() + this.random() * 85 - (this.now() - startedAt)
		if (wait > 0) await this.sleep(wait)
	}
}

/** The process's floor for the `ldap` provider. */
export const directoryResponseFloor = new ResponseFloor()
