import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

function parseScheduleTime(sched: string): { month: number; day: number; hour: number; minute: number } | null {
  try {
    const parts = sched.split(' ')
    if (parts.length !== 2) return null

    const [datePart, timePart] = parts
    const [month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)

    return { month, day, hour, minute }
  } catch {
    return null
  }
}

// Recalculate the next run time after an auto-stop, so the UI always shows a valid upcoming time
function calculateNextRun(schedStart: string, daily: boolean, weekly: boolean): string {
  if (!schedStart) return ''
  const now = new Date()
  try {
    const parts = schedStart.split(' ')
    if (parts.length !== 2) return ''
    const [datePart, timePart] = parts
    const [month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)

    if (daily) {
      const nextRun = new Date()
      nextRun.setHours(hour, minute, 0, 0)
      // If that time has already passed today, jump to tomorrow
      if (now >= nextRun) nextRun.setDate(nextRun.getDate() + 1)
      return `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
    }

    if (weekly) {
      const refDate = new Date(now.getFullYear(), month - 1, day, hour, minute)
      const targetWeekday = refDate.getDay()
      let daysAhead = (targetWeekday - now.getDay() + 7) % 7
      if (daysAhead === 0 && now >= refDate) daysAhead = 7
      const nextRun = new Date(now)
      nextRun.setDate(nextRun.getDate() + daysAhead)
      nextRun.setHours(hour, minute, 0, 0)
      return `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
    }

    return schedStart
  } catch {
    return ''
  }
}

function shouldTrigger(sched: string, isDaily: boolean, isWeekly: boolean): boolean {
  const now = new Date()
  const parsed = parseScheduleTime(sched)

  if (!parsed) return false

  const currentMonth = now.getMonth() + 1
  const currentDay = now.getDate()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentWeekday = now.getDay()

  if (isDaily) {
    return parsed.hour === currentHour && parsed.minute === currentMinute
  }

  if (isWeekly) {
    const refDate = new Date(now.getFullYear(), parsed.month - 1, parsed.day, parsed.hour, parsed.minute)
    const targetWeekday = refDate.getDay()

    return targetWeekday === currentWeekday &&
      parsed.hour === currentHour &&
      parsed.minute === currentMinute
  }

  return parsed.month === currentMonth &&
    parsed.day === currentDay &&
    parsed.hour === currentHour &&
    parsed.minute === currentMinute
}

// GET - Run scheduler check
export async function GET() {
  try {
    const now = new Date()
    const logs: string[] = []

    const slots = await db.streamSlot.findMany({
      where: {
        OR: [
          { isScheduled: true },
          { isRunning: true }
        ]
      }
    })

    let startedCount = 0
    let stoppedCount = 0

    for (const slot of slots) {
      // Check for start
      if (slot.isScheduled && !slot.isRunning && slot.schedStart) {
        if (shouldTrigger(slot.schedStart, slot.daily, slot.weekly)) {
          if (slot.streamKey && slot.filePath) {
            try {
              await fetch(`${STREAM_MANAGER_URL}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slotIndex: slot.slotIndex,
                  rtmpServer: slot.rtmpServer,
                  streamKey: slot.streamKey,
                  filePath: slot.filePath
                })
              })

              await db.streamSlot.update({
                where: { slotIndex: slot.slotIndex },
                data: {
                  isRunning: true,
                  isScheduled: false,
                  status: 'Streaming'
                }
              })
              startedCount++
              logs.push(`Slot ${slot.slotIndex + 1}: Auto-started`)
            } catch {
              logs.push(`Slot ${slot.slotIndex + 1}: Failed to auto-start`)
            }
          }
        }
      }

      // Check for stop
      if (slot.isRunning && slot.schedStop) {
        if (shouldTrigger(slot.schedStop, slot.daily, slot.weekly)) {
          const newStatus = slot.daily || slot.weekly ? 'Completed' : 'Stopped'

          try {
            await fetch(`${STREAM_MANAGER_URL}/stop`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slotIndex: slot.slotIndex })
            })
          } catch {
            // Continue even if stream manager fails
          }

          // Recalculate nextRunTime so the UI shows the upcoming run instead of blank
          const nextRunTime = (slot.daily || slot.weekly)
            ? calculateNextRun(slot.schedStart, slot.daily, slot.weekly)
            : ''

          await db.streamSlot.update({
            where: { slotIndex: slot.slotIndex },
            data: {
              isRunning: false,
              isScheduled: slot.daily || slot.weekly,
              status: newStatus,
              nextRunTime
            }
          })
          stoppedCount++
          logs.push(`Slot ${slot.slotIndex + 1}: Auto-stopped`)
        }
      }
    }

    for (const log of logs) {
      await db.systemLog.create({
        data: { message: log }
      })
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      started: startedCount,
      stopped: stoppedCount,
      logs
    })
  } catch (error) {
    console.error('Scheduler error:', error)
    return NextResponse.json({ error: 'Scheduler failed' }, { status: 500 })
  }
}
