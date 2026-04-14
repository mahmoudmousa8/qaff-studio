import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// POST - Manual Stop streaming
// For one-time streams: cancels all scheduled state permanently.
// For daily/weekly streams: stops the current session but keeps the schedule
// active so the next run happens automatically (isScheduled stays true).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)

    if (isNaN(slotIndex) || slotIndex < 0) {
      return NextResponse.json({ error: 'Invalid slot index' }, { status: 400 })
    }

    const slot = await db.streamSlot.findUnique({ where: { slotIndex } })
    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
    }

    // Call stream-manager to stop FFmpeg
    try {
      await fetch(`${STREAM_MANAGER_URL}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIndex })
      })
    } catch (error) {
      console.error('Failed to connect to stream manager:', error)
    }

    const isRecurring = slot.daily || slot.weekly

    let nextRunTime = ''
    let nextSchedStart = slot.schedStart || ''
    let nextSchedStop = slot.schedStop || ''

    if (isRecurring && slot.schedStart) {
      // Recalculate next run time for daily/weekly streams
      const now = new Date()
      try {
        const parts = slot.schedStart.split(' ')
        if (parts.length === 2) {
          const [, timePart] = parts
          const [hour, minute] = timePart.split(':').map(Number)

          if (!isNaN(hour) && !isNaN(minute)) {
            if (slot.daily) {
              const nextRun = new Date()
              nextRun.setHours(hour, minute, 0, 0)
              if (now >= nextRun) nextRun.setDate(nextRun.getDate() + 1)
              nextRunTime = `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
              nextSchedStart = nextRunTime
            } else if (slot.weekly) {
              const refParts = slot.schedStart.split(' ')
              const [refMonth, refDay] = (refParts[0] || '').split('-').map(Number)
              const refDate = new Date(now.getFullYear(), (refMonth || 1) - 1, refDay || 1, hour, minute)
              const targetWeekday = refDate.getDay()
              let daysAhead = (targetWeekday - now.getDay() + 7) % 7
              if (daysAhead === 0 && now >= refDate) daysAhead = 7
              const nextRun = new Date(now)
              nextRun.setDate(nextRun.getDate() + daysAhead)
              nextRun.setHours(hour, minute, 0, 0)
              nextRunTime = `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
              nextSchedStart = nextRunTime
            }

            // Recalculate schedStop to match next schedStart + original duration
            if (nextSchedStart && slot.schedStop && !slot.schedStop.startsWith('DUR')) {
              const stopParts = slot.schedStop.split(' ')
              if (stopParts.length === 2) {
                const [stopHour, stopMinute] = (stopParts[1] || '').split(':').map(Number)
                const startParts2 = slot.schedStart.split(' ')
                const [startHour, startMinute] = (startParts2[1] || '').split(':').map(Number)
                if (!isNaN(stopHour) && !isNaN(startHour)) {
                  let durMins = (stopHour * 60 + stopMinute) - (startHour * 60 + startMinute)
                  if (durMins < 0) durMins += 1440
                  const nParts = nextSchedStart.split(' ')
                  const [nMonth, nDay] = (nParts[0] || '').split('-').map(Number)
                  const [nHour, nMinute] = (nParts[1] || '').split(':').map(Number)
                  const stopDate = new Date(now.getFullYear(), (nMonth || 1) - 1, nDay || 1, nHour || 0, nMinute || 0)
                  stopDate.setMinutes(stopDate.getMinutes() + durMins)
                  nextSchedStop = `${String(stopDate.getMonth() + 1).padStart(2, '0')}-${String(stopDate.getDate()).padStart(2, '0')} ${String(stopDate.getHours()).padStart(2, '0')}:${String(stopDate.getMinutes()).padStart(2, '0')}`
                }
              }
            }
          }
        }
      } catch {
        // If recalculation fails, keep original schedStart/schedStop
      }
    }

    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        isRunning: false,
        manuallyStopped: true,
        // For recurring streams: keep scheduled so next run happens automatically
        // For one-time streams: cancel scheduling entirely (explicit user choice)
        isScheduled: isRecurring,
        status: isRecurring ? 'Scheduled' : 'Stopped',
        nextRunTime: isRecurring ? nextRunTime : '',
        schedStart: isRecurring ? nextSchedStart : slot.schedStart,
        schedStop: isRecurring ? nextSchedStop : slot.schedStop,
      }
    })

    return NextResponse.json({
      success: true,
      slot: updatedSlot,
      message: isRecurring ? 'Stream stopped — scheduled for next run' : 'Stream stopped'
    })
  } catch (error) {
    console.error('Error stopping stream:', error)
    return NextResponse.json({ error: 'Failed to stop stream' }, { status: 500 })
  }
}
