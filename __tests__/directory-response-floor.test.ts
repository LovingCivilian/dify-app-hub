import { describe, expect, it, vi } from 'vitest'

import { ResponseFloor } from '@/lib/directory/response-floor'

describe("ResponseFloor (decision t, Authelia's timing delay)", () => {
	it('starts at one second, follows the average of the last ten successes, and never goes under 250 ms', () => {
		const floor = new ResponseFloor()
		expect(floor.floorMs()).toBe(1_000)
		floor.record(400)
		floor.record(600)
		expect(floor.floorMs()).toBe(500)
		for (let i = 0; i < 10; i += 1) floor.record(100)
		expect(floor.floorMs()).toBe(250)
	})

	it('waits the rest of the floor plus jitter, and nothing once it has passed', async () => {
		const sleep = vi.fn(() => Promise.resolve())
		const floor = new ResponseFloor({ random: () => 0.5, sleep, now: () => 1_300 })
		floor.record(800)
		await floor.pad(1_000)
		// 800 + 0.5 * 85 - (1_300 - 1_000)
		expect(sleep).toHaveBeenCalledWith(542.5)
		sleep.mockClear()
		await floor.pad(0)
		expect(sleep).not.toHaveBeenCalled()
	})
})
