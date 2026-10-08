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

type ILocalStorageKey = (typeof LocalStorageKeyList)[number]

/**
 * Each key mapped to itself. `Object.fromEntries` builds the object; its result type is a plain record, so the
 * mapped type is asserted once (writing `acc[key] = key` into that type is the unsound write TypeScript 3.5 refuses).
 */
export const LocalStorageKeys = Object.fromEntries(LocalStorageKeyList.map(key => [key, key])) as {
	[K in ILocalStorageKey]: K
}

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
