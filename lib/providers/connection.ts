/**
 * What a provider's connection test found (Part 1 spec §4.2; decision 18): reachable, reachable with a warning, or why
 * it failed. Every provider's `testConnection` answers this shape (lib/providers/registry.ts); a test copies and saves
 * nothing.
 */
export type ConnectionTestResult =
	| { ok: true; warning?: { code: 'type_mismatch'; reported: string } }
	| { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' }
