import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
    const adminUrl = process.env.QAFF_ADMIN_URL
    const clientId = process.env.QAFF_CLIENT_ID

    if (!adminUrl || !clientId) {
        return NextResponse.json({ question: '' })
    }

    try {
        const res = await fetch(`${adminUrl}/api/internal/reset-question`, {
            cache: 'no-store'
        })
        const data = await res.json()
        return NextResponse.json({ question: data.question || '' })
    } catch {
        return NextResponse.json({ question: '' })
    }
}
