import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    // Basic session cookie check
    const cookie = request.cookies.get('qaff_auth')
    if (!cookie?.value) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { resetAnswer, newPassword } = await request.json()

        // Use Accept-Language header for localized responses
        const acceptLang = request.headers.get('accept-language') || 'ar'
        const locale = acceptLang.startsWith('en') ? 'en' : 'ar'

        if (!resetAnswer || !newPassword) {
            return NextResponse.json({ error: locale === 'ar' ? 'بيانات ناقصة' : 'Missing fields' }, { status: 400 })
        }

        if (newPassword.length < 6) {
            return NextResponse.json({ error: locale === 'ar' ? 'كلمة المرور قصيرة جداً' : 'Password too short' }, { status: 400 })
        }

        const adminUrl = process.env.QAFF_ADMIN_URL
        const clientId = process.env.QAFF_CLIENT_ID

        if (!adminUrl || !clientId) {
            return NextResponse.json({
                error: locale === 'ar' ? 'تغيير كلمة المرور متاح فقط عبر لوحة الإدارة المركزية' : 'Password change is only available via central administration'
            }, { status: 403 })
        }

        const res = await fetch(`${adminUrl}/api/internal/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: parseInt(clientId),
                resetAnswer,
                newPassword
            })
        })

        const data = await res.json()

        if (!res.ok) {
            let errorMsg: string = data.error || 'Error'
            if (errorMsg.includes('locked')) {
                errorMsg = locale === 'ar' ? 'تم تعليق حسابك بسبب تجاوز عدد المحاولات (5). يرجى المحاولة بعد 24 ساعة.' : 'Account locked due to 5 failed attempts. Please try again after 24 hours.'
            } else if (errorMsg.includes('Incorrect')) {
                errorMsg = locale === 'ar' ? 'إجابة سؤال الأمان غير صحيحة.' : 'Incorrect reset answer.'
            }
            return NextResponse.json({ error: errorMsg }, { status: res.status })
        }

        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
