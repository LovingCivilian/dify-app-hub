import type { NextRequest } from 'next/server'

import { errorResponseFrom } from '@/lib/dify/errors'
import { brandImageResponse } from '@/lib/settings/image-response'

/** The custom logo (settings spec §4.5). Public: the login page shows it before anyone signs in (lib/access.ts). */
export async function GET(request: NextRequest) {
	try {
		return await brandImageResponse(request, 'logo')
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/branding/logo')
	}
}
