import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

const COOKIE_NAME = 'qaff_auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getPasswordAndHash(): { password: string; hash: string } {
    try {
        const prodPath = '/home/ubuntu/qaff-studio-production/data/password.txt'
        const devPath = path.join(process.cwd(), 'data', 'password.txt')

        let pwPath = devPath
        // Try to check if production path exists (mostly for VPS)
        try {
            if (require('fs').existsSync(prodPath)) {
                pwPath = prodPath
            }
        } catch { }

        const pw = readFileSync(pwPath, 'utf-8').trim()
        return { password: pw, hash: createHash('sha256').update(pw).digest('hex') }
    } catch {
        const pw = 'qaff2024'
        return { password: pw, hash: createHash('sha256').update(pw).digest('hex') }
    }
}

export async function POST(request: NextRequest) {
    try {
        const { password } = await request.json()
        if (!password) return NextResponse.json({ error: 'كلمة المرور مطلوبة' }, { status: 400 })

        const { password: correct, hash } = getPasswordAndHash()

        if (password.trim() !== correct) {
            return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
        }

        // Cookie value = sha256(password) — changes when password.txt changes
        const response = NextResponse.json({ success: true })
        response.cookies.set(COOKIE_NAME, hash, {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 30,
            sameSite: 'lax',
        })
        return response
    } catch {
        return NextResponse.json({ error: 'خطأ في النظام' }, { status: 500 })
    }
}
