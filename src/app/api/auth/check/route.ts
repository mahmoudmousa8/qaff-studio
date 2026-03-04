import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getPasswordHash(): string {
    try {
        const prodPath = '/home/ubuntu/qaff-studio-production/data/password.txt'
        const devPath = path.join(process.cwd(), 'data', 'password.txt')

        let pwPath = devPath
        try {
            if (require('fs').existsSync(prodPath)) {
                pwPath = prodPath
            }
        } catch { }

        const pw = readFileSync(pwPath, 'utf-8').trim()
        return createHash('sha256').update(pw).digest('hex')
    } catch {
        return createHash('sha256').update('qaff2024').digest('hex')
    }
}

// GET — validate current session against current password hash
export async function GET(request: NextRequest) {
    const cookie = request.cookies.get('qaff_auth')
    if (!cookie?.value) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    if (cookie.value !== getPasswordHash()) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    return NextResponse.json({ authenticated: true })
}
