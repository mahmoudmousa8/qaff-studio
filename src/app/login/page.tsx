'use client'

import { useState, useEffect } from 'react'
import { Sun, Moon, Globe } from 'lucide-react'
import { t, isRTL, setLocale, getLocale, Locale } from '@/lib/i18n'

export default function LoginPage() {
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    // Read from DOM — layout.tsx already set the 'dark' class before first paint
    const [isDarkMode, setIsDarkMode] = useState(false)
    const [locale, setLocaleState] = useState<Locale>('ar')

    useEffect(() => {
        // Only read, do NOT re-apply the class (layout.tsx inline script already did it)
        setIsDarkMode(document.documentElement.classList.contains('dark'))
        setLocaleState(getLocale())
    }, [])

    const toggleTheme = () => {
        const root = document.documentElement
        if (isDarkMode) {
            root.classList.remove('dark')
            localStorage.setItem('qaff-theme', 'light')
            setIsDarkMode(false)
        } else {
            root.classList.add('dark')
            localStorage.setItem('qaff-theme', 'dark')
            setIsDarkMode(true)
        }
    }

    const switchLocale = () => {
        const newLocale = locale === 'ar' ? 'en' : 'ar'
        setLocale(newLocale)
        setLocaleState(newLocale)
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            })

            const data = await res.json()

            if (data.success) {
                window.location.href = '/'
            } else {
                setError(data.error || t('invalidPassword'))
            }
        } catch {
            setError(t('connectionError'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative" dir={isRTL() ? 'rtl' : 'ltr'}>
            {/* Top Left Controls */}
            <div className={`absolute top-4 ${isRTL() ? 'right-4' : 'left-4'} flex items-center gap-2`}>
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-full hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                    title={isDarkMode ? t('lightMode') : t('darkMode')}
                >
                    {isDarkMode ? <Sun className="w-5 h-5 text-orange-400" /> : <Moon className="w-5 h-5" />}
                </button>
                <button
                    onClick={switchLocale}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-muted/50 transition-colors text-sm font-medium text-muted-foreground hover:text-foreground"
                    title={t('language')}
                >
                    <Globe className="w-4 h-4" />
                    {locale === 'en' ? 'AR' : 'EN'}
                </button>
            </div>

            <div className="w-full max-w-sm mx-4">
                {/* Card */}
                <div className="bg-card border rounded-2xl shadow-xl p-8">
                    <div className="flex flex-col items-center gap-3 mb-8">
                        {/*
                          Logos: CSS dark: variants react to the 'dark' class already set
                          by layout.tsx before first paint — no JS needed for logo switching.
                        */}
                        <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-3 hover:opacity-80 transition-opacity">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src="/logo-icon.png?v=2"
                                alt="Qaff Streamer"
                                width={64}
                                height={64}
                                className="object-contain dark:hidden"
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src="/logo-white.png?v=2"
                                alt="Qaff Streamer"
                                width={64}
                                height={64}
                                className="object-contain hidden dark:block"
                            />
                            <h1 className="text-2xl font-bold text-primary">Qaff Streamer</h1>
                        </a>
                        <p className="text-sm text-muted-foreground">{t('loginTitle')}</p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder={t('passwordPlaceholder')}
                                autoFocus
                                dir="ltr"
                                className="w-full h-11 px-4 rounded-lg border bg-background text-foreground text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        {error && (
                            <p className="text-red-500 text-sm text-center">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !password}
                            className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                            {loading ? t('loggingIn') : t('loginButton')}
                        </button>
                    </form>
                </div>



                <div className="mt-8 flex flex-col items-center justify-center gap-3 w-full border-t border-border pt-6 text-center">
                    {/* Copyright & WhatsApp Group */}
                    <div className="flex items-center justify-center gap-2">
                        <span className="text-sm font-semibold text-foreground/80">{t('footerText')}</span>
                        <div className="flex items-center gap-2">
                            <a href="https://wa.me/201012656551" target="_blank" rel="noopener noreferrer"
                                className="flex items-center text-green-500 hover:text-green-400 transition-colors font-bold"
                                title="Contact via WhatsApp">
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                </svg>
                            </a>
                            <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer"
                                className="flex items-center text-primary hover:text-primary/80 transition-colors"
                                title="Visit Website">
                                <Globe className="w-5 h-5" />
                            </a>
                        </div>
                    </div>

                    {/* Removed Website Link Details */}
                </div>
            </div>
        </div>
    )
}
