/**
 * Global LocalStorage key prefix
 */
const KEY_PREFIX = '__DC__'

const LocalStorageKeyList = [
	'USER_ID',
	'ENABLE_SETTING',
	'THEME',
	'THEME_MODE',
	'RUNNING_MODE',
	'ENABLE_SETTING',
] as const

export const LocalStorageKeys = LocalStorageKeyList.reduce(
	(acc, key) => {
		// @ts-expect-error known error, to be resolved
		acc[key] = key
		return acc
	},
	{} as { [key in (typeof LocalStorageKeyList)[number]]: key },
)

type ILocalStorageKey = (typeof LocalStorageKeyList)[number]

/**
 * Builds a localStorage key
 */
export const genLocalStorageKey = (key: ILocalStorageKey) => {
	return `${KEY_PREFIX}${key}`
}

/**
 * In-memory fallback: when localStorage is unavailable (private mode, an iframe sandbox, an exhausted
 * quota, …), data is kept in a Map so the app does not crash. Note: the data is lost on a page reload.
 */
const memoryFallback = new Map<string, string>()

/**
 * Tries localStorage and silently falls back to the in-memory store when it fails
 */
const safeGetItem = (key: string): string | null => {
	try {
		return localStorage.getItem(key)
	} catch {
		return memoryFallback.get(key) ?? null
	}
}

const safeSetItem = (key: string, value: string): void => {
	try {
		localStorage.setItem(key, value)
	} catch {
		memoryFallback.set(key, value)
	}
}

/**
 * LocalStorage wrapper
 */
class LocalStorageStoreBuilder {
	validateKey = (key: string) => {
		if (!key) {
			throw new Error('key is required')
		}
		if (!LocalStorageKeyList.some(item => item === key)) {
			throw new Error(`key is not valid, must be one of: ${LocalStorageKeyList.join(',')}`)
		}
		return true
	}

	/**
	 * Reads a localStorage value
	 */
	get = (key: ILocalStorageKey) => {
		this.validateKey(key)
		const storageKey = genLocalStorageKey(key)
		const rawValue = safeGetItem(storageKey)
		let value
		try {
			value = JSON.parse(rawValue as string)
		} catch {
			value = rawValue
		}
		return value
	}

	/**
	 * Writes a localStorage value
	 * @param key must be one of the LocalStorageKeys
	 * @param value must be a string
	 */
	set = (key: ILocalStorageKey, value: string) => {
		this.validateKey(key)
		if (typeof value === 'object' && value !== null) {
			value = JSON.stringify(value)
		}
		const storageKey = genLocalStorageKey(key)
		safeSetItem(storageKey, value)
	}
}

/**
 * The LocalStorage wrapper instance
 */
export const LocalStorageStore = new LocalStorageStoreBuilder()
