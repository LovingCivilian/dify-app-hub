import { redirect } from 'next/navigation'

/**
 * /settings has no page of its own: the first area (settings spec §5.2). It reads nothing, so it needs no gate of its
 * own; the (admin) layout's check does not stop it from running (Next authentication.md, "Layouts and auth checks": "A
 * layout also does not control whether the rest of the route renders"), and /settings/branding checks the admin itself.
 */
export default function SettingsPage() {
	redirect('/settings/branding')
}
