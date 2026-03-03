import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { STREAM_MANAGER_URL } from '@/lib/paths'

export async function GET(request: NextRequest) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
    if (!token || !verifySessionToken(token)) {
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
