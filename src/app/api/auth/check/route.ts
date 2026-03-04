import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Returns the expected session token for the current auth configuration:
 * - Docker mode: sha256(ADMIN_PASSWORD_HASH env var)
 * - Fallback: sha256(password from password.txt or 'qaff2024')
 */
function getExpectedSessionToken(): string {
    const hashEnv = process.env.ADMIN_PASSWORD_HASH
    if (hashEnv) {
        return createHash('sha256').update(hashEnv).digest('hex')
    }

    let correct = 'qaff2024'
    try {
        const prodPath = '/opt/qaff-studio/data/password.txt'
        const devPath = path.join(process.cwd(), 'data', 'password.txt')
        let pwPath = devPath
        try {
            if (require('fs').existsSync(prodPath)) pwPath = prodPath
        } catch { }
        correct = readFileSync(pwPath, 'utf-8').trim()
    } catch { }

    return createHash('sha256').update(correct).digest('hex')
}

// GET — validate current session
export async function GET(request: NextRequest) {
    const cookie = request.cookies.get('qaff_auth')
    if (!cookie?.value) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    if (cookie.value !== getExpectedSessionToken()) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    return NextResponse.json({ authenticated: true })
}
