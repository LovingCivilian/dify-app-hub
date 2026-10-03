// @ts-expect-error next-auth v4 jwt type resolution
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isClientApiPath, isPublicPath } from '@/lib/access'

export async function proxy(request: NextRequest) {
	const { pathname, origin } = request.nextUrl

	// 跳过 API 和静态资源
	if (pathname.startsWith('/api') && !isClientApiPath(pathname)) return NextResponse.next()
	if (pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next()

	// 允许访问初始化页面本身
	if (pathname.startsWith('/init')) return NextResponse.next()

	// 全站鉴权：公开页面以外都需要登录
	if (!isPublicPath(pathname)) {
		const token = await getToken({ req: request })
		if (!token) {
			if (isClientApiPath(pathname)) {
				return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
			}
			const loginUrl = new URL('/login', request.url)
			loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
			return NextResponse.redirect(loginUrl)
		}
		if (isClientApiPath(pathname)) return NextResponse.next()
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
		console.error('初始化状态检查失败:', error)
		// 状态检查失败时不阻断访问，允许后续页面处理
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
