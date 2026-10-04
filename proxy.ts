// @ts-expect-error next-auth v4 jwt type resolution
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isApiPath, isPublicPath, isUngatedPath } from '@/lib/access'

export async function proxy(request: NextRequest) {
	const { pathname, origin } = request.nextUrl

	// 按解码后的路径判断（Next 也会按解码后的路径匹配路由）
	let decoded: string
	try {
		decoded = decodeURIComponent(pathname)
	} catch {
		return NextResponse.json({ error: 'Bad request' }, { status: 400 })
	}

	// 跳过公开 API、静态资源和初始化页面本身
	if (isUngatedPath(decoded)) return NextResponse.next()

	// 全站鉴权：公开页面以外都需要登录，API 默认拒绝
	if (!isPublicPath(decoded)) {
		const token = await getToken({ req: request })
		if (!token) {
			if (isApiPath(decoded)) {
				return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
		console.error('初始化状态检查失败:', error)
		// 状态检查失败时不阻断访问，允许后续页面处理
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
