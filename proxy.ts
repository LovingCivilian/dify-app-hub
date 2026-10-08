import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isApiPath, isPublicPath, isUngatedPath } from '@/lib/access'

export async function proxy(request: NextRequest) {
	const { pathname, origin } = request.nextUrl

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

	// Skip the public APIs, static assets and the init page itself
	if (isUngatedPath(decoded)) return NextResponse.next()

	// Site-wide gate: every page but the public ones needs a session; APIs are denied by default
	if (!isPublicPath(decoded)) {
		const token = await getToken({ req: request })
		// A token without id is one the jwt callback stripped on a sessionVersion mismatch (ADR-0018): no session.
		if (!token?.id) {
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
		if (isApiPath(decoded)) return NextResponse.next()
	}

	try {
		const res = await fetch(`${origin}/api/init/status`, { cache: 'no-store' })
		const data = await res.json()
		const isInitialized = !!data.initialized

		if (!isInitialized) {
			const url = new URL('/init', request.url)
			return NextResponse.redirect(url)
		}
	} catch (error) {
		console.error('Init status check failed:', error)
		// A failed check must not block the page; the pages handle it
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
