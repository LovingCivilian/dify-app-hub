import { redirect } from 'next/navigation'

/** /settings has no page of its own: the first area (settings spec §5.2). The (admin) layout has gated the visitor. */
export default function SettingsPage() {
	redirect('/settings/branding')
}
