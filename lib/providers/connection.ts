/**
 * What a provider's connection test found (Part 1 spec §4.2; decision 18): reachable, reachable with a warning, or why
 * it failed. Every provider's `testConnection` answers this shape (lib/providers/registry.ts); a test copies and saves
 * nothing. Part 2 spec §2.4 adds AG-UI's two: an agent the URL does not name (`agent_not_found`), and an agent that
 * started a run on input it should have refused (`ran_on_invalid_input`, still reachable).
 */
export type ConnectionTestResult =
	| {
			ok: true
			warning?: { code: 'type_mismatch'; reported: string } | { code: 'ran_on_invalid_input' }
	  }
	| { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' | 'agent_not_found' }
