import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import bcrypt from 'bcryptjs'

const COOKIE_NAME = 'qaff_auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Auth strategy:
 * 1. If ADMIN_PASSWORD_HASH env var is set (Docker mode), use bcrypt comparison.
 *    Cookie value = sha256( ADMIN_PASSWORD_HASH ) — stable per container.
 * 2. Otherwise fallback to password.txt file (direct PM2 install mode).
 * 3. Last resort: hardcoded 'qaff2024'.
 */
async function validateLogin(password: string): Promise<{ valid: boolean; sessionToken: string }> {
    const hashEnv = process.env.ADMIN_PASSWORD_HASH

    if (hashEnv) {
        // Docker mode: bcrypt compare
        const valid = await bcrypt.compare(password, hashEnv)
        const sessionToken = createHash('sha256').update(hashEnv).digest('hex')
        return { valid, sessionToken }
    }

    // Fallback: password.txt / hardcoded
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

    const valid = password.trim() === correct
    const sessionToken = createHash('sha256').update(correct).digest('hex')
    return { valid, sessionToken }
}

export async function POST(request: NextRequest) {
    try {
        const { password } = await request.json()
        if (!password) return NextResponse.json({ error: 'كلمة المرور مطلوبة' }, { status: 400 })

        const { valid, sessionToken } = await validateLogin(password)

        if (!valid) {
            return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
        }

        const response = NextResponse.json({ success: true })
        response.cookies.set(COOKIE_NAME, sessionToken, {
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
