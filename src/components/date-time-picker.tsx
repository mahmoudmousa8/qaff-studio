'use client'

import * as React from 'react'
import { CalendarIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

interface DateTimePickerProps {
    /** Current value in "MM-DD HH:MM" format, or empty string */
    value: string
    onChange: (value: string) => void
    className?: string
}

function parseValue(val: string): { month: number; day: number; hour: number; minute: number } {
    if (!val) {
        const n = new Date()
        return { month: n.getMonth() + 1, day: n.getDate(), hour: n.getHours(), minute: n.getMinutes() }
    }
    const [datePart = '', timePart = ''] = val.split(' ')
    const [mm, dd] = datePart.split('-').map(Number)
    const [hh, min] = timePart.split(':').map(Number)
    const now = new Date()
    return {
        month: mm || now.getMonth() + 1,
        day: dd || now.getDate(),
        hour: isNaN(hh) ? 0 : hh,
        minute: isNaN(min) ? 0 : min,
    }
}

function buildValue(month: number, day: number, hour: number, minute: number): string {
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number) {
    return new Date(year, month, 0).getDate()
}

export function DateTimePicker({ value, onChange, className }: DateTimePickerProps) {
    const [open, setOpen] = React.useState(false)

    const now = new Date()
    const parsed = parseValue(value)

    // Calendar state — full year needed for correct day calculation
    const [viewYear, setViewYear] = React.useState(now.getFullYear())
    const [viewMonth, setViewMonth] = React.useState(parsed.month) // 1-based

    // Selected values
    const [selMonth, setSelMonth] = React.useState<number | null>(value ? parsed.month : null)
    const [selDay, setSelDay] = React.useState<number | null>(value ? parsed.day : null)
    const [selHour, setSelHour] = React.useState(parsed.hour)
    const [selMinute, setSelMinute] = React.useState(parsed.minute)

    const hourRef = React.useRef<HTMLDivElement>(null)
    const minuteRef = React.useRef<HTMLDivElement>(null)

    // When popup opens, sync state from current value
    React.useEffect(() => {
        if (open) {
            const p = parseValue(value)
            setViewMonth(p.month)
            setViewYear(now.getFullYear())
            setSelMonth(value ? p.month : null)
            setSelDay(value ? p.day : null)
            setSelHour(p.hour)
            setSelMinute(p.minute)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Auto-scroll time columns to selected value
    React.useEffect(() => {
        if (!open) return
        const timeout = setTimeout(() => {
            scrollToItem(hourRef, selHour)
            scrollToItem(minuteRef, selMinute)
        }, 80)
        return () => clearTimeout(timeout)
    }, [open, selHour, selMinute])

    function scrollToItem(ref: React.RefObject<HTMLDivElement | null>, index: number) {
        if (!ref.current) return
        const ITEM_H = 36
        ref.current.scrollTop = Math.max(0, index * ITEM_H - ITEM_H)
    }

    function handleDayClick(day: number) {
        setSelDay(day)
        setSelMonth(viewMonth)
        // Emit immediately on day selection
        onChange(buildValue(viewMonth, day, selHour, selMinute))
    }

    function handleHourClick(h: number) {
        setSelHour(h)
        if (selDay !== null && selMonth !== null) {
            onChange(buildValue(selMonth, selDay, h, selMinute))
        }
    }

    function handleMinuteClick(m: number) {
        setSelMinute(m)
        if (selDay !== null && selMonth !== null) {
            onChange(buildValue(selMonth, selDay, selHour, m))
        }
    }

    function prevMonth() {
        if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) }
        else setViewMonth(m => m - 1)
    }

    function nextMonth() {
        if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) }
        else setViewMonth(m => m + 1)
    }

    function handleToday() {
        const n = new Date()
        const m = n.getMonth() + 1
        const d = n.getDate()
        const h = n.getHours()
        const min = n.getMinutes()
        setSelMonth(m); setSelDay(d); setSelHour(h); setSelMinute(min)
        setViewMonth(m); setViewYear(n.getFullYear())
        onChange(buildValue(m, d, h, min))
        scrollToItem(hourRef, h)
        scrollToItem(minuteRef, min)
    }

    function handleClear() {
        setSelMonth(null); setSelDay(null)
        onChange('')
        setOpen(false)
    }

    function handleDone() {
        setOpen(false)
    }

    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December']
    const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

    // Build calendar grid
    const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay() // 0 = Sun
    const totalDays = daysInMonth(viewYear, viewMonth)
    const cells: (number | null)[] = []
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
    for (let d = 1; d <= totalDays; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)

    const isSelectedDay = (d: number) => d === selDay && viewMonth === selMonth

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    size="sm"
                    variant="outline"
                    className={cn('h-7 w-7 p-0 shrink-0', className)}
                    title="Pick date and time"
                >
                    <CalendarIcon className="w-3.5 h-3.5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-auto" align="start" sideOffset={4}>
                <div className="flex bg-popover rounded-md shadow-lg border overflow-hidden" style={{ minWidth: 340 }}>
                    {/* ── Calendar panel ── */}
                    <div className="p-3 border-r select-none min-w-[210px]">
                        {/* Month navigation */}
                        <div className="flex items-center justify-between mb-2">
                            <button
                                onClick={prevMonth}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                ←
                            </button>
                            <span className="text-sm font-semibold">
                                {MONTH_NAMES[viewMonth - 1]} {viewYear}
                            </span>
                            <button
                                onClick={nextMonth}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                →
                            </button>
                        </div>

                        {/* Day-of-week headers */}
                        <div className="grid grid-cols-7 mb-1">
                            {DAY_NAMES.map(d => (
                                <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">{d}</div>
                            ))}
                        </div>

                        {/* Day cells */}
                        <div className="grid grid-cols-7 gap-y-0.5">
                            {cells.map((day, i) =>
                                day === null ? (
                                    <div key={`empty-${i}`} />
                                ) : (
                                    <button
                                        key={day}
                                        onClick={() => handleDayClick(day)}
                                        className={cn(
                                            'text-xs h-7 w-7 mx-auto rounded-md transition-colors flex items-center justify-center font-medium',
                                            isSelectedDay(day)
                                                ? 'bg-primary text-primary-foreground'
                                                : 'hover:bg-muted text-foreground'
                                        )}
                                    >
                                        {day}
                                    </button>
                                )
                            )}
                        </div>

                        {/* Clear / Now / Done */}
                        <div className="flex justify-between items-center mt-2 pt-2 border-t">
                            <button
                                onClick={handleClear}
                                className="text-xs text-muted-foreground hover:text-foreground font-medium"
                            >
                                {t('clear') || 'Clear'}
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleToday}
                                    className="text-xs text-primary hover:underline font-medium"
                                >
                                    {t('now') || 'Now'}
                                </button>
                                <button
                                    onClick={handleDone}
                                    className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-2.5 py-1 rounded font-semibold"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Time panel ── */}
                    <div className="flex divide-x" style={{ width: 110 }}>
                        {/* Hours */}
                        <div
                            ref={hourRef}
                            className="flex-1 overflow-y-auto scroll-smooth"
                            style={{ maxHeight: 280 }}
                        >
                            {Array.from({ length: 24 }, (_, h) => (
                                <button
                                    key={h}
                                    onClick={() => handleHourClick(h)}
                                    className={cn(
                                        'w-full h-9 text-sm font-mono flex items-center justify-center transition-colors',
                                        selHour === h
                                            ? 'bg-primary text-primary-foreground font-bold'
                                            : 'hover:bg-muted text-foreground'
                                    )}
                                >
                                    {String(h).padStart(2, '0')}
                                </button>
                            ))}
                        </div>
                        {/* Minutes */}
                        <div
                            ref={minuteRef}
                            className="flex-1 overflow-y-auto scroll-smooth"
                            style={{ maxHeight: 280 }}
                        >
                            {Array.from({ length: 60 }, (_, m) => (
                                <button
                                    key={m}
                                    onClick={() => handleMinuteClick(m)}
                                    className={cn(
                                        'w-full h-9 text-sm font-mono flex items-center justify-center transition-colors',
                                        selMinute === m
                                            ? 'bg-primary text-primary-foreground font-bold'
                                            : 'hover:bg-muted text-foreground'
                                    )}
                                >
                                    {String(m).padStart(2, '0')}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
