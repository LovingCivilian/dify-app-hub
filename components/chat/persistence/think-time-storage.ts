import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { indexedDBStorage } from '@/lib/helpers/indexeddb-storage'

interface ThinkTimeStore {
	data: Record<string, number>
	setTime: (key: string, elapsedTime: number) => void
	getTime: (key: string) => number | undefined
}

const useThinkTimeStore = create<ThinkTimeStore>()(
	persist(
		(set, get) => ({
			data: {},
			setTime: (key, elapsedTime) => {
				// An existing value is not overwritten (the first recorded, exact time is kept)
				if (get().data[key] !== undefined) return
				set(state => ({ data: { ...state.data, [key]: elapsedTime } }))
			},
			getTime: key => get().data[key],
		}),
		{
			name: 'think-time-storage',
			storage: createJSONStorage(() => indexedDBStorage),
			partialize: state => ({ data: state.data }),
		},
	),
)

export const getThinkTime = (key: string) => useThinkTimeStore.getState().getTime(key)
export const setThinkTime = (key: string, elapsedTime: number) =>
	useThinkTimeStore.getState().setTime(key, elapsedTime)

export default useThinkTimeStore
