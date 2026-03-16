import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { STREAM_MANAGER_URL } from '@/lib/paths'

const COOKIE_NAME = 'qaff_auth'

function isAuthenticated(request: NextRequest): boolean {
    const cookie = request.cookies.get(COOKIE_NAME)?.value
    if (!cookie) return false
    const hashEnv = process.env.ADMIN_PASSWORD_HASH
    if (hashEnv) {
        return cookie === createHash('sha256').update(hashEnv).digest('hex')
    }
    return true // middleware already validated — trust it
}

export async function GET(request: NextRequest) {
    if (!isAuthenticated(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const res = await fetch(`${STREAM_MANAGER_URL}/stats/ram`, {
            cache: 'no-store'
        })
        const data = await res.json()
        return NextResponse.json(data)
    } catch {
        return NextResponse.json({ usedPercent: 0, usedMB: 0, totalMB: 0 }, { status: 200 })
    }
}
