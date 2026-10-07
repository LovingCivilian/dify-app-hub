import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { indexedDBStorage } from '@/lib/helpers/indexeddb-storage'

// The options shared by getting and setting data
export type IWorkflowDataOptions = {
	appId: string
	conversationId: string
	messageId: string
	key: string
}

// The options for setting data: IWorkflowDataOptions plus the value
export type IWorkflowDataSetOptions = IWorkflowDataOptions & {
	value: unknown
}

interface WorkflowStore {
	data: Record<string, unknown>
	setData: (id: string, value: unknown) => void
	getData: (id: string) => unknown
	getAllData: () => { id: string; value: unknown }[]
}

// Exported for its persist API (hydration state, read by the chat history loader).
export const useWorkflowStore = create<WorkflowStore>()(
	persist(
		(set, get) => ({
			data: {},
			setData: (id, value) => {
				set(state => ({
					data: {
						...state.data,
						[id]: value,
					},
				}))
			},
			getData: id => {
				return get().data[id]
			},
			getAllData: () => {
				const data = get().data
				return Object.entries(data).map(([id, value]) => ({ id, value }))
			},
		}),
		{
			name: 'workflow-data-storage',
			storage: createJSONStorage(() => indexedDBStorage),
			partialize: state => ({ data: state.data }),
		},
	),
)

/**
 * Workflow data storage: zustand state with persistence.
 * Advantages:
 * 1. Reads come from memory, so they are fast enough for the frequent reads and writes of streamed output
 * 2. Persisted automatically, so the data is still there after a page reload
 * 3. Simpler asynchronous handling
 */
class WorkflowDataStorage {
	/**
	 * Builds the storage key
	 */
	private generateId(options: IWorkflowDataOptions): string {
		const { appId, conversationId, messageId, key } = options
		return `${appId}_${conversationId}_${messageId}_${key}`
	}

	/**
	 * Gets the data
	 * @param options the app ID, conversation ID, message ID and data key
	 * @returns the data
	 */
	async get(options: IWorkflowDataOptions): Promise<unknown> {
		const id = this.generateId(options)
		return useWorkflowStore.getState().getData(id)
	}

	/**
	 * Sets the data
	 * @param options the app ID, conversation ID, message ID, data key and data value
	 */
	async set(options: IWorkflowDataSetOptions): Promise<void> {
		const { value } = options
		const id = this.generateId(options)
		useWorkflowStore.getState().setData(id, value)
	}

	/**
	 * Gets all cached data
	 * @returns an array of every cached entry
	 */
	async listAll(): Promise<{ id: string; value: unknown }[]> {
		return useWorkflowStore.getState().getAllData()
	}
}

export default new WorkflowDataStorage()
