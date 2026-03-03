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

interface LiveStats {
    ramPercent: number
    bitrateMbps: number
}

export default function LogsPage() {
    const router = useRouter()
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [locale, setLocaleState] = useState<Locale>('en')
    const [isDarkMode, setIsDarkMode] = useState(false)
    const [liveStats, setLiveStats] = useState<LiveStats>({ ramPercent: 0, bitrateMbps: 0 })
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

    const fetchLiveStats = async () => {
        try {
            const [ramRes, bitrateRes] = await Promise.all([
                fetch('/api/stats/ram'),
                fetch('/api/stats/bitrate')
            ])
            const [ramData, bitrateData] = await Promise.all([
                ramRes.json(), bitrateRes.json()
            ])
            setLiveStats({
                ramPercent: ramData.usedPercent || 0,
                bitrateMbps: bitrateData.bitrateMbps || 0,
            })
        } catch { }
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
        fetchLiveStats()
        const logsInterval = setInterval(fetchLogs, 5000)
        const statsInterval = setInterval(fetchLiveStats, 3000)
        return () => { clearInterval(logsInterval); clearInterval(statsInterval) }
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
                        <Image src="/logo-icon.png?v=1" unoptimized alt="Qaff Streamer" width={28} height={28} priority className="object-contain dark:hidden" />
                        <Image src="/logo-white.png?v=1" unoptimized alt="Qaff Streamer" width={28} height={28} priority className="object-contain hidden dark:block" />
                        <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-muted-foreground" />
                            <h1 className="text-base font-bold text-primary">{t('logs')}</h1>
                            <Badge variant="secondary" className="text-xs">{logs.length}</Badge>
                        </div>
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

                {/* Live Stats Bar — RAM + Network */}
                <div className="flex items-center gap-4 px-4 py-1.5 border-t bg-muted/30 text-xs" dir="ltr">
                    <div className="flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-semibold text-foreground">{t('ramUsage')}</span>
                        <Badge className={`text-white text-[10px] px-1.5 py-0 ${liveStats.ramPercent > 85 ? 'bg-red-500' : liveStats.ramPercent > 65 ? 'bg-amber-500' : 'bg-green-500'}`}>
                            {liveStats.ramPercent}%
                        </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-semibold text-foreground">{t('dataRate')}</span>
                        <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0">
                            {liveStats.bitrateMbps > 0 ? `${liveStats.bitrateMbps.toFixed(2)} Mbps` : '— Mbps'}
                        </Badge>
                    </div>
                    <div className="ml-auto">
                        <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" style={{ animationDuration: '3s' }} />
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
        </div>
    )
}
