import BrandingSettings from '@/components/admin/settings/branding-settings'
import { requireAdminUser } from '@/lib/auth/session'
import { getBrandingSettings } from '@/lib/settings/branding'
import { BUILT_IN_LOGO } from '@/lib/settings/built-in-logo'

/** Settings > Branding (settings spec §5.3): the server checks the admin and loads the mode and values (ADR-0020). */
export default async function BrandingPage() {
	const actor = await requireAdminUser()
	return <BrandingSettings settings={await getBrandingSettings(actor, BUILT_IN_LOGO)} />
}
