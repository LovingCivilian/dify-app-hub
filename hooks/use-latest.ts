import { useRef } from 'react'

// Could move to the shared hooks
export function useLatest<T>(value: T) {
	const ref = useRef(value)
	ref.current = value
	return ref
}
