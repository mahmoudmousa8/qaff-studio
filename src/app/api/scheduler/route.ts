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

function shouldTrigger(sched: string, isStopCheck: boolean = false): boolean {
  // If the schedule is completely invalid or a DUR pseudo-state, do not trigger auto
  if (!sched || sched.startsWith('DUR')) return false

  const now = new Date()
  const parsed = parseScheduleTime(sched)
  if (!parsed) return false

  const targetDate = new Date(now.getFullYear(), parsed.month - 1, parsed.day, parsed.hour, parsed.minute)
  const diffMs = now.getTime() - targetDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  // Up to 60 minutes grace period for Stop, 5 mins for Start
  const grace = isStopCheck ? 60 : 5
  return diffMins >= 0 && diffMins <= grace
}

// GET - Run scheduler check
export async function GET() {
  try {
    const now = new Date()
    const logs: string[] = []

    // 1) Fetch currently active streams from Stream Manager
    let activeInManager: Set<number> = new Set()
    let streamManagerResponded = false
    try {
      // Abort controller so it doesn't hang the scheduler if stream-manager is completely down
      const abortCtrl = new AbortController()
      const t = setTimeout(() => abortCtrl.abort(), 3000)
      const res = await fetch(`${STREAM_MANAGER_URL}/status`, { signal: abortCtrl.signal })
      clearTimeout(t)
      if (res.ok) {
        streamManagerResponded = true
        const data = await res.json()
        if (Array.isArray(data.activeStreams)) {
          activeInManager = new Set(data.activeStreams)
        }
      }
    } catch (e) {
      console.warn('Could not reach stream manager for health check:', e)
    }

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
      // ── Auto-Recovery for Crashed Streams ────────────────────
      if (slot.isRunning && streamManagerResponded && !activeInManager.has(slot.slotIndex)) {
          // The database says it should be running, but stream-manager doesn't have it!
          // This means FFmpeg crashed or disconnected (e.g. YouTube reset the ingest).
          // We will attempt to restart it.
          try {
            const res = await fetch(`${STREAM_MANAGER_URL}/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                slotIndex: slot.slotIndex,
                outputType: slot.outputType,
                rtmpServer: slot.rtmpServer,
                streamKey: slot.streamKey,
                filePath: slot.filePath
              })
            })
            const data = await res.json()
            if (res.ok && data.success) {
              logs.push(`Slot ${slot.slotIndex + 1}: Auto-recovered crashed stream`)
            } else {
              logs.push(`Slot ${slot.slotIndex + 1}: Auto-recovery failed: ${data.error || 'stream-manager rejected start'}`)
            }
          } catch (e: any) {
            logs.push(`Slot ${slot.slotIndex + 1}: Auto-recovery failed: ${e.message || 'Network error'}`)
          }
      }

      // ── Auto-Start ──────────────────────────────────────────
      // Precondition check (cheap, avoids DB round-trip for non-matching slots)
      if (slot.isScheduled && !slot.isRunning && slot.schedStart && slot.streamKey && slot.filePath) {
        if (shouldTrigger(slot.schedStart)) {

          // ── Atomic DB lock ──────────────────────────────────
          // updateMany with isRunning=false in the WHERE clause acts as a
          // compare-and-swap. If two requests land simultaneously, only one will
          // get count=1 and proceed. The other gets count=0 and is silently skipped.
          const claimed = await db.streamSlot.updateMany({
            where: {
              slotIndex: slot.slotIndex,
              isRunning: false,        // ← atomic guard: only succeed if NOT already running
              isScheduled: true,       // ← extra safety: must still be in scheduled state
            },
            data: {
              isRunning: true,
              isScheduled: false,
              status: 'Streaming',
            }
          })

          if (claimed.count === 0) {
            // Another request already claimed this slot — skip silently
            continue
          }

          // We own the slot — now start the stream
          try {
            await fetch(`${STREAM_MANAGER_URL}/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                slotIndex: slot.slotIndex,
                outputType: slot.outputType,
                rtmpServer: slot.rtmpServer,
                streamKey: slot.streamKey,
                filePath: slot.filePath
              })
            })
            startedCount++
            logs.push(`Slot ${slot.slotIndex + 1}: Auto-started`)
          } catch {
            // Stream manager failed — roll back the DB claim so it retries next tick
            await db.streamSlot.update({
              where: { slotIndex: slot.slotIndex },
              data: {
                isRunning: false,
                isScheduled: true,
                status: 'Scheduled',
              }
            })
            logs.push(`Slot ${slot.slotIndex + 1}: Failed to auto-start (rolled back)`)
          }
        }
      }

      // ── Auto-Stop ───────────────────────────────────────────
      if (slot.isRunning && slot.schedStop) {
        if (shouldTrigger(slot.schedStop, true)) {

          // Step 1: Tell stream-manager to stop FFmpeg FIRST
          try {
            await fetch(`${STREAM_MANAGER_URL}/stop`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slotIndex: slot.slotIndex })
            })
          } catch (e) {
            logs.push(`Slot ${slot.slotIndex + 1}: Auto-stop failed (stream-manager unreachable) — will retry`)
            await db.systemLog.create({ data: { message: `Slot ${slot.slotIndex + 1}: Auto-stop failed, will retry next tick` } })
            continue
          }

          // Step 2: Calculate Next Occurrence to Advance
          let nextStartTime = slot.schedStart || ''
          let nextStopTime = slot.schedStop || ''
          
          if (slot.daily || slot.weekly) {
            const oldStart = parseScheduleTime(slot.schedStart)
            const oldStop = parseScheduleTime(slot.schedStop)
            
            if (oldStart && oldStop) {
               // Calculate original duration safely around midnight
               const startMins = oldStart.hour * 60 + oldStart.minute;
               const stopMins = oldStop.hour * 60 + oldStop.minute;
               let durMins = stopMins - startMins;
               if (durMins < 0) durMins += 1440;
               
               // Advance start time
               nextStartTime = calculateNextRun(slot.schedStart, slot.daily, slot.weekly)
               
               // Re-add the duration to get the advanced stop time
               const nParsed = parseScheduleTime(nextStartTime)
               if (nParsed) {
                   const nDate = new Date(new Date().getFullYear(), nParsed.month - 1, nParsed.day, nParsed.hour, nParsed.minute)
                   nDate.setMinutes(nDate.getMinutes() + durMins)
                   const fMonth = String(nDate.getMonth() + 1).padStart(2, '0')
                   const fDate = String(nDate.getDate()).padStart(2, '0')
                   const fH = String(nDate.getHours()).padStart(2, '0')
                   const fM = String(nDate.getMinutes()).padStart(2, '0')
                   nextStopTime = `${fMonth}-${fDate} ${fH}:${fM}`
               }
            }
          }

          const newStatus = slot.daily || slot.weekly ? 'Scheduled' : 'Stopped'
          const claimed = await db.streamSlot.updateMany({
            where: {
              slotIndex: slot.slotIndex,
              isRunning: true,
            },
            data: {
              isRunning: false,
              isScheduled: slot.daily || slot.weekly,
              status: newStatus,
              schedStart: nextStartTime,
              schedStop: nextStopTime,
              nextRunTime: nextStartTime
            }
          })

          if (claimed.count === 0) continue  // already stopped by another request

          stoppedCount++
          logs.push(`Slot ${slot.slotIndex + 1}: Auto-stopped`)
        }
      }
    }

    for (const log of logs) {
      await db.systemLog.create({ data: { message: log } })
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
