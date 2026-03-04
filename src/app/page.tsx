'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DebouncedInput } from '@/components/ui/debounced-input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Play, Square, Clock, RotateCcw, Save, RefreshCw,
  Sun, Moon, Calendar, AlertCircle,
  Loader2, ChevronLeft, ChevronRight, FolderOpen, Activity, HardDrive,
  Film, Globe, LogOut, Copy, Check, FileText, Wifi
} from 'lucide-react'
import Image from 'next/image'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VideoManager } from '@/components/video-manager'
import { DateTimePicker } from '@/components/date-time-picker'
import { t, getLocale, setLocale, isRTL, type Locale } from '@/lib/i18n'

// Ã¢â€â‚¬Ã¢â€â‚¬ RTMP base URLs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const RTMP_BASES: Record<string, string> = {
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp',
}

interface StreamSlot {
  id: string
  slotIndex: number
  channelName: string
  outputType: string
  streamKey: string
  rtmpServer: string
  filePath: string
  schedStart: string
  schedStop: string
  daily: boolean
  weekly: boolean
  isScheduled: boolean
  nextRunTime: string
  status: string
  isRunning: boolean
}

interface LogEntry {
  id: string
  message: string
  timestamp: string
}

interface ChannelLogsState {
  slotIndex: number
  logs: LogEntry[]
  ramPercent: number
  bitrateMbps: number
  loading: boolean
}

const SLOTS_PER_PAGE = 50

// Ã¢â€â‚¬Ã¢â€â‚¬ Copy to clipboard helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    })
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }
  return { copy, copiedKey }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Copy Button component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function CopyButton({ text, id, title, className }: { text: string; id: string; title?: string; className?: string }) {
  const { copy, copiedKey } = useCopyToClipboard()
  const isCopied = copiedKey === id
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className || "h-6 w-6 p-0 shrink-0 hover:bg-muted"}
      onClick={() => copy(text, id)}
      title={title || t('copy')}
      disabled={!text}
    >
      {isCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </Button>
  )
}

export default function Home() {
  const router = useRouter()
  const [slots, setSlots] = useState<StreamSlot[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoSave, setAutoSave] = useState(true)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalSlots, setTotalSlots] = useState(0)
  const [stats, setStats] = useState({ streaming: 0, scheduled: 0, stopped: 0, configured: 0, dailyCount: 0, weeklyCount: 0, renewalDate: null as string | null })
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; action: string; onConfirm: () => void } | null>(null)
  const [videoSelectorSlot, setVideoSelectorSlot] = useState<number | null>(null)
  const [videosManagerOpen, setVideosManagerOpen] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ used: string; free: string; total: string; percent: number } | null>(null)
  const [locale, setLocaleState] = useState<Locale>('en')
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [channelLogs, setChannelLogs] = useState<ChannelLogsState | null>(null)
  const channelLogsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Password change state
  const [pwDialogOpen, setPwDialogOpen] = useState(false)
  const [pwResetQuestion, setPwResetQuestion] = useState('')
  const [pwResetAnswer, setPwResetAnswer] = useState('')
  const [pwNewPassword, setPwNewPassword] = useState('')
  const [pwConfirmPassword, setPwConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)

  // Timezone state
  const [tzDialogOpen, setTzDialogOpen] = useState(false)
  const [currentTz, setCurrentTz] = useState('')
  const [selectedTz, setSelectedTz] = useState('')
  const [savingTz, setSavingTz] = useState(false)
  const logViewportRef = useRef<HTMLDivElement>(null)

  // Initialize locale and theme
  useEffect(() => {
    setLocaleState(getLocale())
    setIsDarkMode(document.documentElement.classList.contains('dark'))
  }, [])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
    }
  }, [logs])

  // Session validation
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/check')
        if (!res.ok) window.location.href = '/login'
      } catch { }
    }
    checkAuth()
    const interval = setInterval(checkAuth, 5 * 60 * 1000)
    return () => clearInterval(interval)
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

  // Fetch TZ when dialog opens
  useEffect(() => {
    if (tzDialogOpen) {
      fetch('/api/settings/timezone')
        .then(res => res.json())
        .then(data => {
          if (data.success) { setCurrentTz(data.timezone); setSelectedTz(data.timezone) }
        }).catch(() => { })
    }
  }, [tzDialogOpen])

  const saveTimezone = async () => {
    setSavingTz(true)
    try {
      const res = await fetch('/api/settings/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: selectedTz })
      })
      const data = await res.json()
      if (data.success) {
        addLog(data.message)
        setTimeout(() => window.location.reload(), 3000)
      } else {
        addLog('Error: ' + data.error)
      }
    } catch {
      addLog('Failed to save timezone')
    }
    setSavingTz(false)
    setTzDialogOpen(false)
  }

  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/slots?page=${currentPage}&limit=${SLOTS_PER_PAGE}`)
      if (res.status === 401) { window.location.href = '/login'; return }
      const data = await res.json()
      setSlots(data.slots || [])
      setTotalSlots(data.total || 0)
    } catch { addLog('Error fetching slots') }
    finally { setLoading(false) }
  }, [currentPage])

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs')
      if (res.status === 401) { window.location.href = '/login'; return }
      const data = await res.json()
      setLogs(data.logs || [])
    } catch { }
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.status === 401) { window.location.href = '/login'; return }
      const data = await res.json()
      setStats(data)
    } catch { }
  }, [])

  const fetchStorage = useCallback(async () => {
    try {
      const res = await fetch('/api/storage')
      if (res.status === 401) { window.location.href = '/login'; return }
      const data = await res.json()
      if (data.disk) {
        setStorageInfo({
          used: data.disk.usedFormatted || data.disk.used,
          free: data.disk.freeFormatted || data.disk.free,
          total: data.disk.totalFormatted || data.disk.total,
          percent: data.disk.usedPercent || 0
        })
      }
    } catch { }
  }, [])

  useEffect(() => {
    fetchSlots(); fetchLogs(); fetchStats(); fetchStorage()

    const statusInterval = setInterval(async () => {
      try { await fetch('/api/status'); fetchSlots(); fetchStats() } catch { }
    }, 5000)

    const schedulerInterval = setInterval(async () => {
      try { await fetch('/api/scheduler'); fetchSlots(); fetchLogs(); fetchStats() } catch { }
    }, 60000)

    return () => { clearInterval(statusInterval); clearInterval(schedulerInterval) }
  }, [fetchSlots, fetchLogs, fetchStats, fetchStorage])

  const addLog = async (message: string) => {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      })
      fetchLogs()
    } catch { }
  }

  const updateSlot = async (index: number, updates: Partial<StreamSlot>) => {
    try {
      await fetch(`/api/slots/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (autoSave) fetchSlots()
    } catch { addLog(`Error updating slot ${index + 1}`) }
  }

  const handleSlotChange = (index: number, field: keyof StreamSlot, value: string | boolean) => {
    setSlots(prev => prev.map(slot =>
      slot.slotIndex === index ? { ...slot, [field]: value } : slot
    ))
    updateSlot(index, { [field]: value })
  }

  const handleOutputTypeChange = (slotIndex: number, newType: string) => {
    // When switching to YouTube/Facebook, set the fixed RTMP base
    const newRtmpServer = RTMP_BASES[newType] || ''
    setSlots(prev => prev.map(slot =>
      slot.slotIndex === slotIndex
        ? { ...slot, outputType: newType, rtmpServer: newRtmpServer }
        : slot
    ))
    updateSlot(slotIndex, { outputType: newType, rtmpServer: newRtmpServer })
  }

  const startStream = async (index: number) => {
    const slot = slots.find(s => s.slotIndex === index)
    if (!slot) return

    const outputType = slot.outputType || 'youtube'

    // Client-side validation
    if (!slot.filePath) {
      addLog(`Slot ${index + 1}: ${t('fileNotFound')}`)
      return
    }
    if ((outputType === 'youtube' || outputType === 'facebook') && !slot.streamKey?.trim()) {
      addLog(`Slot ${index + 1}: ${t('streamKeyRequired')}`)
      return
    }
    if ((outputType === 'tiktok' || outputType === 'custom') &&
      (!slot.rtmpServer?.trim() || (!slot.rtmpServer.startsWith('rtmp://') && !slot.rtmpServer.startsWith('rtmps://')))) {
      addLog(`Slot ${index + 1}: ${t('invalidRtmpUrl')}`)
      return
    }
    if ((outputType === 'tiktok' || outputType === 'custom') && !slot.streamKey?.trim()) {
      addLog(`Slot ${index + 1}: ${t('streamKeyRequired')}`)
      return
    }

    try {
      const res = await fetch(`/api/slots/${index}/start`, { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        // Translate i18n error codes from server
        const errMsg = t(data.error as any) || data.error
        addLog(`Slot ${index + 1}: ${errMsg}`)
      } else {
        const msg = (data.message || t('streamRunning')).replace(/^Slot\s+\d+:\s*/i, '')
        addLog(`Slot ${index + 1}: ${msg}`)
      }
      fetchSlots()
    } catch {
      addLog(`Slot ${index + 1}: ${t('streamFailed')}`)
    }
  }

  const stopStream = async (index: number) => {
    try {
      await fetch(`/api/slots/${index}/stop`, { method: 'POST' })
      addLog(`Slot ${index + 1}: Stopped`)
      fetchSlots()
    } catch { addLog(`Slot ${index + 1}: Error stopping stream`) }
  }

  const scheduleSlot = async (index: number) => {
    const slot = slots.find(s => s.slotIndex === index)
    if (!slot?.schedStart) { addLog(`Slot ${index + 1}: ${t('outputIncomplete')}`); return }

    const outputType = slot.outputType || 'youtube'
    if ((outputType === 'youtube' || outputType === 'facebook') && !slot.streamKey?.trim()) {
      addLog(`Slot ${index + 1}: ${t('streamKeyRequired')}`); return
    }
    if ((outputType === 'tiktok' || outputType === 'custom') &&
      (!slot.rtmpServer?.trim() || (!slot.rtmpServer.startsWith('rtmp://') && !slot.rtmpServer.startsWith('rtmps://')))) {
      addLog(`Slot ${index + 1}: ${t('invalidRtmpUrl')}`); return
    }
    if ((outputType === 'tiktok' || outputType === 'custom') && !slot.streamKey?.trim()) {
      addLog(`Slot ${index + 1}: ${t('streamKeyRequired')}`); return
    }

    try {
      await fetch(`/api/slots/${index}/schedule`, { method: 'POST' })
      addLog(`Slot ${index + 1}: Scheduled`)
      fetchSlots()
    } catch { addLog(`Slot ${index + 1}: Error scheduling`) }
  }

  const resetSlot = async (index: number) => {
    try {
      await fetch(`/api/slots/${index}/reset`, { method: 'POST' })
      addLog(`Slot ${index + 1}: Reset`)
      fetchSlots()
    } catch { addLog(`Slot ${index + 1}: Error resetting`) }
  }

  const setQuickTime = (index: number, type: 'am' | 'pm') => {
    const now = new Date()
    let target: Date
    if (type === 'am') {
      target = new Date(now); target.setDate(target.getDate() + 1); target.setHours(0, 0, 0, 0)
    } else {
      target = new Date(now)
      if (now.getHours() >= 12) target.setDate(target.getDate() + 1)
      target.setHours(12, 0, 0, 0)
    }
    const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const endTime = new Date(target.getTime() + 11 * 60 * 60 * 1000 + 45 * 60 * 1000)
    handleSlotChange(index, 'schedStart', fmt(target))
    handleSlotChange(index, 'schedStop', fmt(endTime))
  }

  const bulkAction = async (action: string) => {
    try {
      const res = await fetch('/api/slots/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json()
      addLog(data.message)
      if (data.errors) data.errors.forEach((err: string) => addLog(err))
      fetchSlots(); fetchStats()
    } catch { addLog(`Error in bulk action: ${action}`) }
  }

  const confirmBulkAction = (action: string, actionName: string) => {
    setConfirmDialog({ open: true, action: actionName, onConfirm: () => { bulkAction(action); setConfirmDialog(null) } })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Streaming': return 'bg-green-500'
      case 'Starting': return 'bg-yellow-500'
      case 'Scheduled': return 'bg-orange-500'
      case 'Completed': return 'bg-blue-500'
      case 'Failed': return 'bg-red-600'
      default: return 'bg-slate-500'
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Per-channel Logs Panel Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openChannelLogs = async (slotIndex: number) => {
    setChannelLogs({ slotIndex, logs: [], ramPercent: 0, bitrateMbps: 0, loading: true })

    const refresh = async () => {
      try {
        const [logsRes, ramRes, bitrateRes] = await Promise.all([
          fetch(`/api/logs?slotIndex=${slotIndex}`),
          fetch('/api/stats/ram'),
          fetch(`/api/stats/bitrate?slotIndex=${slotIndex}`)
        ])
        const [logsData, ramData, bitrateData] = await Promise.all([
          logsRes.json(), ramRes.json(), bitrateRes.json()
        ])
        setChannelLogs(prev => prev?.slotIndex === slotIndex ? {
          ...prev,
          logs: logsData.logs || [],
          ramPercent: ramData.usedPercent || 0,
          bitrateMbps: bitrateData.bitrateMbps || 0,
          loading: false
        } : prev)
      } catch {
        setChannelLogs(prev => prev ? { ...prev, loading: false } : null)
      }
    }

    await refresh()

    if (channelLogsIntervalRef.current) clearInterval(channelLogsIntervalRef.current)
    channelLogsIntervalRef.current = setInterval(refresh, 3000)
  }

  const closeChannelLogs = () => {
    if (channelLogsIntervalRef.current) { clearInterval(channelLogsIntervalRef.current); channelLogsIntervalRef.current = null }
    setChannelLogs(null)
  }

  // Build final RTMP URL for display / copying
  const getFinalRtmpUrl = (slot: StreamSlot): string => {
    const outputType = slot.outputType || 'youtube'
    if (outputType === 'youtube') return `rtmp://a.rtmp.youtube.com/live2/${slot.streamKey}`
    if (outputType === 'facebook') return `rtmps://live-api-s.facebook.com:443/rtmp/${slot.streamKey}`
    // TikTok / Custom: server + key
    const srv = slot.rtmpServer?.trim() || ''
    const key = slot.streamKey?.trim() || ''
    if (srv && key) return `${srv.replace(/\/$/, '')}/${key}`
    return srv || key
  }

  const totalPages = Math.ceil(totalSlots / SLOTS_PER_PAGE)
  const dir = locale === 'ar' ? 'rtl' : 'ltr'

  const getDaysRemaining = (dateString?: string | null) => {
    if (!dateString) return null
    // Compare strictly the dates removing times
    const d1 = new Date(dateString)
    d1.setHours(0, 0, 0, 0)
    const d2 = new Date()
    d2.setHours(0, 0, 0, 0)
    const diffTime = d1.getTime() - d2.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }
  const daysRemaining = getDaysRemaining(stats.renewalDate)

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">{t('loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background" dir="ltr">
      {/* â€•â€•â€• Header â€•â€•â€• */}
      <header className="border-b bg-card shrink-0 z-50">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Image src="/logo-icon.png?v=1" unoptimized alt="Qaff Streamer" width={32} height={32} priority className="object-contain dark:hidden" />
                <Image src="/logo-white.png?v=1" unoptimized alt="Qaff Streamer" width={32} height={32} priority className="object-contain hidden dark:block" />
                <h1 className="text-lg font-bold text-primary">Qaff Streamer</h1>
              </a>
              <Badge className="bg-green-500 text-white text-xs">
                <Play className="w-3 h-3 mr-1" />
                {stats.streaming} {t('active')}
              </Badge>
              <Badge className="bg-orange-500 text-white text-xs">
                <Calendar className="w-3 h-3 mr-1" />
                {stats.scheduled} {t('scheduled')}
              </Badge>
              {stats.renewalDate && (
                <Badge className={`${(daysRemaining ?? 0) <= 0 ? 'bg-red-600 animate-pulse' : (daysRemaining ?? 0) <= 5 ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white text-xs transition-colors cursor-default`}>
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {(daysRemaining ?? 0) > 0
                    ? `${t('renewalPrefix')} ${daysRemaining} ${t('renewalDaysSuffix')}`
                    : t('renewalExpired')
                  }
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setVideosManagerOpen(true)}>
                <Film className="w-4 h-4 mr-1" />
                {t('videos')}
              </Button>

              <Button size="sm" variant="outline" onClick={() => router.push('/logs')}>
                <Activity className="w-4 h-4 mr-1" />
                {t('logs')}
              </Button>

              <Button size="sm" variant="ghost" onClick={switchLocale} title={t('language')}>
                <Globe className="w-4 h-4 mr-1" />
                {locale === 'en' ? 'AR' : 'EN'}
              </Button>

              <Button size="sm" variant="ghost" onClick={toggleTheme} title={t('theme')}>
                {isDarkMode ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4" />}
              </Button>

              <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700 h-7 text-xs w-auto px-3"
                onClick={() => confirmBulkAction('startAll', t('confirmStartAll'))}>
                <Play className="w-3.5 h-3.5 mr-1" />{t('startAll')}
              </Button>
              <Button size="sm" variant="outline" className="border-green-600 text-green-600 hover:bg-green-50 h-7 text-xs w-auto px-3"
                onClick={() => confirmBulkAction('scheduleAll', t('confirmScheduleAll'))}>
                <Clock className="w-3.5 h-3.5 mr-1" />{t('scheduleAllExt')}
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs w-[100px]"
                onClick={() => confirmBulkAction('stopAll', t('confirmStopAll'))}>
                <Square className="w-3.5 h-3.5 mr-1" />{t('stopAll')}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs w-[120px]"
                onClick={() => confirmBulkAction('setTimeAll', t('confirmSetTimeAll'))}>
                <Clock className="w-3.5 h-3.5 mr-1" />{t('setTimeAll')}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs w-[100px]"
                onClick={() => confirmBulkAction('dailyAll', t('confirmDailyAll'))}>
                <Sun className="w-3.5 h-3.5 mr-1" />{t('dailyAll')}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs w-[110px]"
                onClick={() => confirmBulkAction('resetAll', t('confirmResetAll'))}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" />{t('resetAll')}
              </Button>

              <div className="w-px h-5 bg-border mx-1" />

              <Button size="sm" variant="outline" className="h-7 text-xs w-[120px]"
                onClick={() => setTzDialogOpen(true)} title={t('timezoneServer')}>
                <Globe className="w-3.5 h-3.5 mr-1" />{t('timezoneBtn')}
              </Button>
              <Button size="sm" variant={autoSave ? "default" : "outline"} className="h-7 text-xs w-[130px]"
                onClick={() => setAutoSave(!autoSave)}>
                <Save className="w-3.5 h-3.5 mr-1" />{t('autoSave')}: {autoSave ? 'ON' : 'OFF'}
              </Button>

              <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7"
                title={t('logout')}
                onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login' }}>
                <LogOut className="w-4 h-4" />
              </Button>

              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                setPwDialogOpen(true); setPwError(''); setPwSuccess(false); setPwResetAnswer(''); setPwNewPassword(''); setPwConfirmPassword('')
                // Fetch the security question from admin
                try {
                  const r = await fetch('/api/settings/reset-question')
                  const d = await r.json()
                  setPwResetQuestion(d.question || '')
                } catch { setPwResetQuestion('') }
              }}>
                🔑 {locale === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}
              </Button>
            </div>
          </div>

          {/* Storage bar */}
          {storageInfo && (
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              <HardDrive className="w-3.5 h-3.5" />
              <span>{t('storage')}: {storageInfo.used} {t('used')} | {storageInfo.free} {t('free')}</span>
              <div className="flex-1 max-w-[200px] h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${storageInfo.percent > 90 ? 'bg-red-500' : storageInfo.percent > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(storageInfo.percent, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* â€•â€•â€• Main Content â€•â€•â€• */}
      <main className="flex-1 flex flex-col overflow-hidden px-4 py-2 gap-2">
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-4 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t('slots')}</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7" disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground min-w-[80px] text-center" dir="ltr">
                  {currentPage} / {totalPages}
                </span>
                <Button size="sm" variant="outline" className="h-7" disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <div className="h-full overflow-auto">
              <table className="w-full border-collapse" style={{ minWidth: 1530, tableLayout: 'fixed' }}>
                <thead className="sticky top-0 bg-card z-10 shadow-sm">
                  <tr className="bg-muted/50 border-b">
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 28 }}>#</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 110 }}>{t('colDetails')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 160 }}>{t('colFilePath')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 500 }}>{t('colSchedule')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 70 }}>{t('colStatus')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 90 }}>{t('colPlatform')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 450 }}>{t('colOutputSettings')}</th>
                    <th className="text-center text-xs font-semibold px-2 py-1.5" style={{ width: 120 }}>{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => {
                    const outputType = slot.outputType || 'youtube'
                    const isYtFb = outputType === 'youtube' || outputType === 'facebook'
                    const rtmpBase = RTMP_BASES[outputType] || ''
                    const finalRtmpUrl = getFinalRtmpUrl(slot)

                    return (
                      <tr key={slot.id} className="hover:bg-muted/30 transition-colors border-b border-border/50">
                        {/* # */}
                        <td className="text-center font-mono text-xs font-medium px-2 py-1 text-muted-foreground">
                          {slot.slotIndex + 1}
                        </td>

                        {/* Channel Name */}
                        <td className="px-2 py-1">
                          <DebouncedInput
                            value={slot.channelName}
                            onChange={(val) => handleSlotChange(slot.slotIndex, 'channelName', val)}
                            className="h-6 text-xs"
                            placeholder={t('optional')}
                            dir="auto"
                          />
                        </td>

                        {/* File Path */}
                        <td className="px-2 py-1">
                          <div className="flex gap-1 items-center flex-nowrap">
                            <Input
                              readOnly
                              value={slot.filePath ? slot.filePath.split(/[/\\]/).pop() : ''}
                              className="h-6 text-[11px] flex-1 font-mono bg-muted/10 text-muted-foreground cursor-default outline-none"
                              placeholder={t('phFilePath')}
                              title={slot.filePath}
                              dir="ltr"
                            />
                            <Button size="sm" variant="outline" className="h-6 w-6 p-0 shrink-0"
                              onClick={() => setVideoSelectorSlot(slot.slotIndex)} title={t('select')}>
                              <FolderOpen className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>

                        {/* Schedule */}
                        <td className="px-2 py-1" style={{ overflow: 'hidden' }}>
                          <div className="flex flex-row items-center gap-1.5 flex-nowrap">
                            {/* Start Group */}
                            <div className="flex gap-1 items-center bg-muted/40 px-1.5 py-1 rounded shrink-0">
                              <div className="flex items-center justify-center w-[18px] h-[18px] bg-green-500/15 text-green-600 rounded-[4px] shrink-0 border border-green-500/20">
                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 ml-[1px]">
                                  <path d="M5.5 3.5l14 8.5-14 8.5v-17z" />
                                </svg>
                              </div>
                              <div className="flex bg-background border rounded overflow-hidden">
                                <Input
                                  value={slot.schedStart ? slot.schedStart.split(' ')[0] || '' : ''}
                                  onChange={(e) => {
                                    const dp = e.target.value
                                    const tp = slot.schedStart ? (slot.schedStart.split(' ')[1] || '00:00') : '00:00'
                                    handleSlotChange(slot.slotIndex, 'schedStart', dp ? `${dp} ${tp}` : '')
                                  }}
                                  className="h-6 text-[10px] font-mono w-[46px] text-center px-0.5 border-0 focus-visible:ring-0 rounded-none"
                                  placeholder="MM-DD" maxLength={5} dir="ltr"
                                />
                                <div className="w-px bg-border" />
                                <Input
                                  value={slot.schedStart ? (slot.schedStart.split(' ')[1] || '') : ''}
                                  onChange={(e) => {
                                    const tp = e.target.value
                                    const dp = slot.schedStart ? (slot.schedStart.split(' ')[0] || '') : ''
                                    handleSlotChange(slot.slotIndex, 'schedStart', dp ? `${dp} ${tp}` : '')
                                  }}
                                  className="h-6 text-[10px] font-mono w-[46px] text-center px-0.5 border-0 focus-visible:ring-0 rounded-none"
                                  placeholder="HH:MM" maxLength={5} dir="ltr"
                                />
                              </div>
                              <DateTimePicker value={slot.schedStart || ''} onChange={(v) => handleSlotChange(slot.slotIndex, 'schedStart', v)} className="h-6 w-6 ml-0.5" />
                            </div>

                            {/* Stop Group */}
                            <div className="flex gap-1 items-center bg-muted/40 px-1.5 py-1 rounded shrink-0">
                              <div className="flex items-center justify-center w-[18px] h-[18px] bg-red-500/15 text-red-500 rounded-[4px] shrink-0 border border-red-500/20">
                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5">
                                  <rect x="5" y="5" width="14" height="14" rx="3.5" />
                                </svg>
                              </div>
                              <div className="flex bg-background border rounded overflow-hidden">
                                <Input
                                  value={slot.schedStop ? slot.schedStop.split(' ')[0] || '' : ''}
                                  onChange={(e) => {
                                    const dp = e.target.value
                                    const tp = slot.schedStop ? (slot.schedStop.split(' ')[1] || '00:00') : '00:00'
                                    handleSlotChange(slot.slotIndex, 'schedStop', dp ? `${dp} ${tp}` : '')
                                  }}
                                  className="h-6 text-[10px] font-mono w-[46px] text-center px-0.5 border-0 focus-visible:ring-0 rounded-none"
                                  placeholder="MM-DD" maxLength={5} dir="ltr"
                                />
                                <div className="w-px bg-border" />
                                <Input
                                  value={slot.schedStop ? (slot.schedStop.split(' ')[1] || '') : ''}
                                  onChange={(e) => {
                                    const tp = e.target.value
                                    const dp = slot.schedStop ? (slot.schedStop.split(' ')[0] || '') : ''
                                    handleSlotChange(slot.slotIndex, 'schedStop', dp ? `${dp} ${tp}` : '')
                                  }}
                                  className="h-6 text-[10px] font-mono w-[46px] text-center px-0.5 border-0 focus-visible:ring-0 rounded-none"
                                  placeholder="HH:MM" maxLength={5} dir="ltr"
                                />
                              </div>
                              <DateTimePicker value={slot.schedStop || ''} onChange={(v) => handleSlotChange(slot.slotIndex, 'schedStop', v)} className="h-6 w-6 ml-0.5" />
                            </div>

                            {/* Quick Actions */}
                            <div className="flex gap-1 items-center shrink-0">
                              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[9px]"
                                onClick={() => setQuickTime(slot.slotIndex, 'am')}>
                                AM
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[9px]"
                                onClick={() => setQuickTime(slot.slotIndex, 'pm')}>
                                PM
                              </Button>
                              <div className="flex items-center gap-1 ml-1 bg-muted/20 px-1.5 py-0.5 rounded border border-border/50">
                                <div className="flex items-center gap-0.5">
                                  <Checkbox checked={slot.daily} onCheckedChange={(c) => { handleSlotChange(slot.slotIndex, 'daily', !!c); if (c) handleSlotChange(slot.slotIndex, 'weekly', false) }} id={`daily-${slot.slotIndex}`} className="w-3 h-3" />
                                  <label htmlFor={`daily-${slot.slotIndex}`} className="text-[9px] text-muted-foreground mr-1 cursor-pointer select-none">D</label>
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <Checkbox checked={slot.weekly} onCheckedChange={(c) => { handleSlotChange(slot.slotIndex, 'weekly', !!c); if (c) handleSlotChange(slot.slotIndex, 'daily', false) }} id={`weekly-${slot.slotIndex}`} className="w-3 h-3" />
                                  <label htmlFor={`weekly-${slot.slotIndex}`} className="text-[9px] text-muted-foreground cursor-pointer select-none">W</label>
                                </div>
                              </div>
                            </div>
                            {slot.nextRunTime && (
                              <div className="text-[10px] text-blue-500 font-mono ml-1 shrink-0">{slot.nextRunTime}</div>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="text-center px-2 py-1">
                          <Badge className={`${getStatusColor(slot.status)} text-white text-[10px] font-medium`}>
                            {slot.status}
                          </Badge>
                        </td>

                        {/* Platform (Dropdown) */}
                        <td className="px-2 py-1">
                          <select
                            value={outputType}
                            onChange={(e) => handleOutputTypeChange(slot.slotIndex, e.target.value)}
                            className="h-6 text-xs rounded-md border border-input bg-background px-2 w-full focus:outline-none focus:ring-2 focus:ring-ring"
                            dir="ltr"
                          >
                            <option value="youtube">{t('optYouTube')}</option>
                            <option value="facebook">{t('optFacebook')}</option>
                            <option value="custom">{t('optCustom')}</option>
                          </select>
                        </td>

                        {/* Output Settings */}
                        <td className="px-2 py-1">
                          <div className="flex flex-row gap-1 items-center w-full flex-nowrap">
                            {isYtFb ? (
                              <>
                                <Input
                                  value={rtmpBase}
                                  readOnly
                                  className="h-6 text-[10px] font-mono bg-muted/50 text-muted-foreground flex-1 min-w-[60px] cursor-default"
                                  dir="ltr"
                                  title={rtmpBase}
                                />
                                <DebouncedInput
                                  value={slot.streamKey}
                                  onChange={(val) => handleSlotChange(slot.slotIndex, 'streamKey', val)}
                                  className="h-6 text-[11px] font-mono flex-1 min-w-0"
                                  placeholder={t('phStreamKey')}
                                  dir="ltr"
                                />
                              </>
                            ) : (
                              <>
                                <DebouncedInput
                                  value={slot.rtmpServer}
                                  onChange={(val) => handleSlotChange(slot.slotIndex, 'rtmpServer', val)}
                                  className="h-6 text-[10px] font-mono w-[140px] shrink-0"
                                  placeholder={t('phCustomServer')}
                                  dir="ltr"
                                  title={t('rtmpBaseLabel')}
                                />
                                <DebouncedInput
                                  value={slot.streamKey}
                                  onChange={(val) => handleSlotChange(slot.slotIndex, 'streamKey', val)}
                                  className="h-6 text-[11px] font-mono flex-1 min-w-0"
                                  placeholder={t('phStreamKey')}
                                  dir="ltr"
                                />
                              </>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-1">
                          <div className="flex gap-1 justify-center flex-nowrap">
                            <Button size="sm" variant="default" className="h-6 w-6 p-0 bg-green-600 hover:bg-green-700"
                              disabled={slot.isRunning}
                              onClick={() => startStream(slot.slotIndex)}
                              title={t('startAll')}>
                              <Play className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="secondary" className="h-6 w-6 p-0"
                              disabled={slot.isRunning || slot.isScheduled}
                              onClick={() => scheduleSlot(slot.slotIndex)}
                              title={t('scheduleAllExt')}>
                              <Calendar className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="destructive" className="h-6 w-6 p-0"
                              disabled={!slot.isRunning && !slot.isScheduled}
                              onClick={() => stopStream(slot.slotIndex)}
                              title={t('stopAll')}>
                              <Square className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-muted"
                              onClick={() => resetSlot(slot.slotIndex)}
                              title={t('resetAll')}>
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main >

      {/* â€•â€•â€• Footer â€•â€•â€• */}
      <footer className="border-t bg-card/50 py-4 shrink-0 mt-auto shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
        <div className="container overflow-x-auto overflow-y-hidden">
          <div className="flex flex-col items-center justify-center gap-3 px-4 text-center">

            {/* Copyright & WhatsApp Group */}
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-semibold text-foreground/80">{t('footerText')}</span>
              <div className="flex items-center gap-1.5">
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

            {/* Website Link Details */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-muted-foreground">
                {t('footerMoreInfo')} <a href="https://streamer.qaff.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://streamer.qaff.net</a>
              </span>
            </div>

          </div>
        </div>
      </footer>

      {/* Ã¢â€¢Â Ã¢â€¢Â Ã¢â€¢Â  Per-Channel Logs Dialog Ã¢â€¢Â Ã¢â€¢Â Ã¢â€¢Â  */}
      < Dialog open={!!channelLogs
      } onOpenChange={(open) => !open && closeChannelLogs()}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col" dir={dir}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {t('channelLogs')} #{channelLogs ? channelLogs.slotIndex + 1 : ''}
            </DialogTitle>
          </DialogHeader>

          {/* Live Stats Bar */}
          {channelLogs && (
            <div className="flex items-center gap-4 py-2 px-3 bg-muted/50 rounded-md shrink-0 text-sm" dir="ltr">
              <div className="ml-auto">
                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" style={{ animationDuration: '3s' }} />
              </div>
            </div>
          )}

          {/* Logs scroll area */}
          <div className="flex-1 overflow-auto min-h-0 bg-black/90 rounded-md p-3 font-mono text-xs" dir="ltr">
            {channelLogs?.loading ? (
              <div className="flex items-center justify-center h-20 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />{t('loading')}
              </div>
            ) : channelLogs?.logs.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">{t('noLogs')}</div>
            ) : (
              channelLogs?.logs.map((log) => (
                <div key={log.id} className="text-green-400 py-0.5 leading-relaxed">
                  <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString('en-GB', { hour12: false })} </span>
                  {log.message}
                </div>
              ))
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={closeChannelLogs}>{t('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog >

      {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Timezone Dialog Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
      < Dialog open={tzDialogOpen} onOpenChange={setTzDialogOpen} >
        <DialogContent className="sm:max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              {t('timezoneServer')}
            </DialogTitle>
            <DialogDescription>{t('timezoneWarning')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold">{t('timezoneCurrent')}</label>
              <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded border border-border/50">
                {currentTz || t('timezoneLoading')}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold">{t('timezoneNew')}</label>
              <select
                value={selectedTz}
                onChange={(e) => setSelectedTz(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                dir="ltr"
              >
                <option value="UTC">UTC</option>
                {['Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'].map(region => (
                  <optgroup key={region} label={region}>
                    {Intl.supportedValuesOf('timeZone').filter(tz => tz.startsWith(`${region}/`)).map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button type="button" variant="default" onClick={saveTimezone}
              disabled={savingTz || !selectedTz || selectedTz === currentTz}>
              {savingTz ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t('timezoneSave')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setTzDialogOpen(false)}>{t('cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog >

      {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Videos Manager Dialog Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
      < Dialog open={videosManagerOpen} onOpenChange={setVideosManagerOpen} >
        <DialogContent className="sm:max-w-6xl w-[95vw] max-h-[95vh] h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Film className="w-5 h-5" />{t('videosManager')}
            </DialogTitle>
            <DialogDescription>{t('browseAndSelect')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            <VideoManager mode="manage" onClose={() => setVideosManagerOpen(false)} />
          </div>
        </DialogContent>
      </Dialog >

      {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Video Selector Dialog Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
      < Dialog open={videoSelectorSlot !== null} onOpenChange={(open) => !open && setVideoSelectorSlot(null)}>
        <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[95vh] h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              {t('selectVideoForSlot')} #{videoSelectorSlot !== null ? videoSelectorSlot + 1 : ''}
            </DialogTitle>
            <DialogDescription>{t('browseAndSelect')}</DialogDescription>
          </DialogHeader>
          {videoSelectorSlot !== null && (
            <div className="flex-1 overflow-hidden min-h-0">
              <VideoManager
                mode="select"
                onVideoSelect={(path) => { handleSlotChange(videoSelectorSlot, 'filePath', path); setVideoSelectorSlot(null) }}
                onClose={() => setVideoSelectorSlot(null)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog >

      {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â Confirm Dialog Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
      < Dialog open={confirmDialog?.open} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('confirm')}</DialogTitle>
            <DialogDescription>{confirmDialog?.action}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>{t('cancel')}</Button>
            <Button variant="default" onClick={confirmDialog?.onConfirm}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog >

      {/* ── Change Password Dialog ── */}
      <Dialog open={pwDialogOpen} onOpenChange={(open) => !open && setPwDialogOpen(false)}>
        <DialogContent className="sm:max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              🔑 {locale === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'ar'
                ? 'أدخل إجابة سؤال الأمان ثم كلمة المرور الجديدة. سيُعاد تشغيل النظام خلال لحظات.'
                : 'Enter your security question answer and a new password. System will restart briefly.'}
            </DialogDescription>
          </DialogHeader>
          {pwSuccess ? (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-green-600">
                {locale === 'ar' ? 'تم تغيير كلمة المرور بنجاح! سيتم إعادة تشغيل النظام خلال لحظات.' : 'Password changed successfully! The system will restart shortly.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-2">
              {pwError && (
                <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-md border border-red-200 dark:border-red-800">
                  {pwError}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {pwResetQuestion ? (
                  <div className="bg-muted/50 border border-border/70 rounded-md p-3 text-sm font-medium" dir={dir}>
                    <span className="text-xs text-muted-foreground block mb-1">{locale === 'ar' ? 'سؤال إعادة التعيين:' : 'Security Question:'}</span>
                    {pwResetQuestion}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                    {locale === 'ar' ? '❌ لم يتم تعيين سؤال إعادة التعيين بعد. تواصل مع المسؤول.' : '❌ No security question has been set yet. Contact your administrator.'}
                  </div>
                )}
                <label className="text-sm font-semibold">
                  {locale === 'ar' ? 'إجابتك على السؤال' : 'Your Answer'}
                </label>
                <Input
                  value={pwResetAnswer}
                  onChange={(e) => setPwResetAnswer(e.target.value)}
                  placeholder={locale === 'ar' ? '5 أحرف/أرقام كما حُدد مسبقًا' : '5-char answer as set by admin'}
                  dir="ltr"
                  className="font-mono"
                  maxLength={5}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold">
                  {locale === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}
                </label>
                <Input
                  type="password"
                  value={pwNewPassword}
                  onChange={(e) => setPwNewPassword(e.target.value)}
                  placeholder={locale === 'ar' ? '6 أحرف على الأقل' : 'At least 6 characters'}
                  dir="ltr"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold">
                  {locale === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                </label>
                <Input
                  type="password"
                  value={pwConfirmPassword}
                  onChange={(e) => setPwConfirmPassword(e.target.value)}
                  placeholder={locale === 'ar' ? 'أعد كتابة كلمة المرور' : 'Repeat password'}
                  dir="ltr"
                />
              </div>
            </div>
          )}
          {!pwSuccess && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setPwDialogOpen(false)} disabled={pwLoading}>
                {locale === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                variant="default"
                disabled={pwLoading || !pwResetAnswer || !pwNewPassword || !pwConfirmPassword}
                onClick={async () => {
                  setPwError('')
                  if (pwNewPassword !== pwConfirmPassword) {
                    setPwError(locale === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match')
                    return
                  }
                  if (pwNewPassword.length < 6) {
                    setPwError(locale === 'ar' ? 'كلمة المرور قصيرة جداً' : 'Password too short')
                    return
                  }
                  setPwLoading(true)
                  try {
                    const res = await fetch('/api/settings/password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
                      body: JSON.stringify({ resetAnswer: pwResetAnswer, newPassword: pwNewPassword })
                    })
                    const data = await res.json()
                    if (data.success) {
                      setPwSuccess(true)
                    } else {
                      setPwError(data.error || (locale === 'ar' ? 'حدث خطأ' : 'An error occurred'))
                    }
                  } catch {
                    setPwError(locale === 'ar' ? 'تعذر الاتصال' : 'Connection failed')
                  } finally {
                    setPwLoading(false)
                  }
                }}
              >
                {pwLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                {locale === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div >
  )
}
