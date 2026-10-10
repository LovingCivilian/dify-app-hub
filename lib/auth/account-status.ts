/**
 * An account's status (B3 spec §5, ADR-0027): two independent deactivation markers, one written by an admin and one
 * by the directory sync (B3b), each set and cleared only by its owner; the account is active only while both are
 * empty. Fails closed (decision a): a marker read as undefined, such as from a select that left the column out,
 * counts as set. Client-safe: it imports nothing.
 */
export interface DeactivationMarkers {
	adminDeactivatedAt: Date | null
	directoryDeactivatedAt: Date | null
}

export const isActive = (markers: DeactivationMarkers): boolean =>
	markers.adminDeactivatedAt === null && markers.directoryDeactivatedAt === null
