import type { NextRequest } from 'next/server'

import { errorResponseFrom } from '@/lib/dify/errors'
import { readBrandImageVersion } from '@/lib/settings/branding'
import { brandImageResponse } from '@/lib/settings/image-response'

/** The custom tab icon, else the custom logo (settings spec §4.1, §4.5). Public, like the logo. */
export async function GET(request: NextRequest) {
	try {
		const kind = (await readBrandImageVersion('favicon')) ? 'favicon' : 'logo'
		return await brandImageResponse(request, kind)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/branding/favicon')
	}
}
