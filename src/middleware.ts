import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'qaff_auth'
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/check']

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Allow public paths
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next()
    }

    // Fast fail if no cookie exists
    const auth = request.cookies.get(COOKIE_NAME)
    if (!auth?.value) {
        return NextResponse.redirect(new URL('/login', request.url))
    }

    // Verify the session hash with the Node.js API endpoint
    // We pass the cookie header so the API can read it
    try {
        const checkUrl = new URL('/api/auth/check', request.url)
        const checkRes = await fetch(checkUrl, {
            headers: { cookie: request.headers.get('cookie') || '' },
            cache: 'no-store'
        })

        if (checkRes.ok) {
            return NextResponse.next()
        }
    } catch (err) {
        console.error('Middleware cookie check failed:', err)
    }

    // Not authenticated, expired, or invalid hash — redirect to login
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
}

export const config = {
    // Exclude /api/upload from middleware — Edge Middleware has a hard 10MB body limit
    // which would truncate large file uploads before they reach the API route handler.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-icon.png|logo-white.png|api/upload).*)'],
}
