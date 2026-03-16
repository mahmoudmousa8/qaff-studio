import { NextResponse } from 'next/server'

const CLIENT_ID = process.env.QAFF_CLIENT_ID || ''
const COOKIE_NAME = CLIENT_ID ? `qaff_auth_${CLIENT_ID}` : 'qaff_auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST() {
    const response = NextResponse.json({ success: true })
    response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        path: '/',
        maxAge: 0,
    })
    return response
}
