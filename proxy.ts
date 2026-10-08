import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isApiPath, isPublicPath } from '@/lib/access'

/**
 * The optimistic check of Next's authentication guide (the proxy reads the cookie; layouts, pages, actions and
 * handlers verify the session themselves): a public path passes, any other needs a token with an id (a revoked
 * token has none, ADR-0018). First run is the login layout's job (charter §4.2), so the proxy makes no request
 * of its own.
 */
export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	// Classify by the decoded path (Next matches routes on the decoded path too)
	let decoded: string
	try {
		decoded = decodeURIComponent(pathname)
	} catch {
		return NextResponse.json(
			{ code: 'invalid_param', message: 'Bad request.', status: 400 },
			{ status: 400 },
		)
	}

	if (isPublicPath(decoded)) return NextResponse.next()

	const token = await getToken({ req: request })
	if (token?.id) return NextResponse.next()

	if (isApiPath(decoded)) {
		return NextResponse.json(
			{ code: 'unauthorized', message: 'Sign in required.', status: 401 },
			{ status: 401 },
		)
	}
	const loginUrl = new URL('/login', request.url)
	loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
	return NextResponse.redirect(loginUrl)
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
