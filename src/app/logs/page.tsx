'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, RefreshCw, Trash2, Loader2, Terminal, Sun, Moon, Globe, HardDrive, Wifi } from 'lucide-react'
import Image from 'next/image'
import { t, getLocale, setLocale, type Locale } from '@/lib/i18n'

interface LogEntry {
    id: string
    message: string
    timestamp: string
}

export default function LogsPage() {
    const router = useRouter()
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [locale, setLocaleState] = useState<Locale>('en')
    const [isDarkMode, setIsDarkMode] = useState(false)
    const logViewportRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setLocaleState(getLocale())
        setIsDarkMode(document.documentElement.classList.contains('dark'))
    }, [])

    // Auto-scroll to bottom on new logs
    useEffect(() => {
        if (logViewportRef.current) {
            logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
        }
    }, [logs])

    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/logs')
            if (res.status === 401) {
                window.location.href = '/login'
                return
            }
            const data = await res.json()
            setLogs(data.logs || [])
        } catch (err) {
            console.error('Error fetching logs', err)
        } finally {
            setLoading(false)
        }
    }

    const clearLogs = async () => {
        try {
            const res = await fetch('/api/logs', { method: 'DELETE' })
            if (res.status === 401) { window.location.href = '/login'; return }
            await fetchLogs()
        } catch (err) {
            console.error('Error clearing logs', err)
        }
    }

    useEffect(() => {
        fetchLogs()
        const logsInterval = setInterval(fetchLogs, 5000)
        return () => { clearInterval(logsInterval) }
    }, [])

    const switchLocale = () => {
        const newLocale = locale === 'en' ? 'ar' : 'en'
        setLocale(newLocale)
        setLocaleState(newLocale)
    }

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

    const getLogColor = (message: string) => {
        const msg = message.toLowerCase()
        if (msg.includes('error') || msg.includes('fail') || msg.includes('خطأ')) return 'text-red-500'
        if (msg.includes('start') || msg.includes('success') || msg.includes('بدأ') || msg.includes('نجح')) return 'text-green-500'
        if (msg.includes('stop') || msg.includes('end') || msg.includes('إيقاف')) return 'text-orange-400'
        if (msg.includes('warn') || msg.includes('تحذير')) return 'text-yellow-500'
        return 'text-foreground'
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-background" dir="ltr">
            {/* Header */}
            <header className="border-b bg-card shrink-0">
                <div className="px-4 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                        <Button size="sm" variant="ghost" onClick={() => router.push('/')} className="h-8 gap-1.5">
                            <ArrowLeft className="w-4 h-4" />
                            {t('back') || 'Back'}
                        </Button>
                        <div className="w-px h-5 bg-border" />
                        <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                            <Image src="/logo-icon.png?v=1" unoptimized alt="Qaff Streamer" width={28} height={28} priority className="object-contain dark:hidden" />
                            <Image src="/logo-white.png?v=1" unoptimized alt="Qaff Streamer" width={28} height={28} priority className="object-contain hidden dark:block" />
                            <div className="flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-muted-foreground" />
                                <h1 className="text-base font-bold text-primary">{t('logs')}</h1>
                                <Badge variant="secondary" className="text-xs">{logs.length}</Badge>
                            </div>
                        </a>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" onClick={switchLocale} title={t('language')}>
                            <Globe className="w-4 h-4 mr-1" />
                            {locale === 'en' ? 'AR' : 'EN'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={toggleTheme} title={t('theme')}>
                            {isDarkMode ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4" />}
                        </Button>
                        <Button size="sm" variant="outline" onClick={fetchLogs} className="h-7">
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />
                            {t('refresh')}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={clearLogs} className="h-7">
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            {t('delete') || 'Clear'}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Logs Content */}
            <main className="flex-1 overflow-hidden p-4">
                <Card className="h-full flex flex-col">
                    <CardHeader className="py-2 px-4 shrink-0 border-b">
                        <CardTitle className="text-sm text-muted-foreground font-semibold flex items-center gap-2">
                            <Terminal className="w-4 h-4" />
                            {t('logs')} — {new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-EG', {
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric'
                            })}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0">
                        {loading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div
                                ref={logViewportRef}
                                className="h-full overflow-y-auto p-3 font-mono text-xs bg-muted/20 space-y-0.5"
                            >
                                {logs.length === 0 ? (
                                    <p className="text-muted-foreground text-center py-8">{t('noLogs')}</p>
                                ) : (
                                    logs.map((log) => (
                                        <div key={log.id} className="flex gap-3 py-0.5 border-b border-border/20 last:border-0">
                                            <span className="text-primary font-semibold shrink-0 min-w-[90px]">
                                                [{new Date(log.timestamp).toLocaleTimeString()}]
                                            </span>
                                            <span className={getLogColor(log.message)}>{log.message}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </main>

            {/* Footer */}
            <footer className="border-t bg-card/50 py-3 shrink-0 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
                <div className="container overflow-x-auto">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 min-w-[500px]">
                        <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                            <Image src="/logo-icon.png" alt="Qaff Logo" width={24} height={24} className="brightness-0 invert opacity-50 dark:opacity-80" />
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-foreground/80">{t('footerText')}</span>
                            </div>
                        </a>
                        <a href="https://wa.me/201012656551" target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 text-green-500 hover:text-green-400 transition-colors font-bold">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            01012656551
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    )
}
