/**
 * run-scheduler.ts
 *
 * Core scheduling logic extracted so it can be called:
 *   (a) Directly from server-scheduler.ts (no HTTP, no loopback)
 *   (b) Via the GET /api/scheduler HTTP endpoint (for manual triggers / debugging)
 *
 * This eliminates the loopback fetch that was fragile in Docker/standalone.
 */

import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// Tracks how many consecutive ticks each slot has been absent from stream-manager.
// Requires 4 missed ticks before triggering auto-recovery to prevent spurious restarts.
const missCounters = new Map<string, number>()

// ── Helpers ────────────────────────────────────────────────────────────────

function parseScheduleTime(sched: string): { month: number; day: number; hour: number; minute: number } | null {
  try {
    const parts = sched.split(' ')
    if (parts.length !== 2) return null
    const [datePart, timePart] = parts
    const [month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    if (isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) return null
    return { month, day, hour, minute }
  } catch {
    return null
  }
}

// Normalize a date to the current-year context (handles cross-year schedules up to ±180 days)
function normalizeToNow(d: Date, now: Date): Date {
  if (now.getTime() - d.getTime() > 1000 * 60 * 60 * 24 * 180) {
    d.setFullYear(now.getFullYear() + 1)
  } else if (d.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 180) {
    d.setFullYear(now.getFullYear() - 1)
  }
  return d
}

/**
 * resolveStopDate
 *
 * Converts schedStop to an actual Date regardless of format:
 *  - "MM-DD HH:MM"  → direct parse
 *  - "DUR HH:MM"    → anchorDate + duration minutes
 *
 * anchorDate is schedStart date (for window checks) or now (for live start).
 */
function resolveStopDate(schedStop: string, anchorDate: Date, now: Date): Date | null {
  if (!schedStop) return null

  if (schedStop.startsWith('DUR ')) {
    const [hStr, mStr] = schedStop.replace('DUR ', '').split(':')
    const durMins = parseInt(hStr || '0') * 60 + parseInt(mStr || '0')
    if (isNaN(durMins) || durMins <= 0) return null
    return new Date(anchorDate.getTime() + durMins * 60 * 1000)
  }

  const parsedStop = parseScheduleTime(schedStop)
  if (!parsedStop) return null
  return normalizeToNow(
    new Date(now.getFullYear(), parsedStop.month - 1, parsedStop.day, parsedStop.hour, parsedStop.minute, 0),
    now
  )
}

/**
 * durToActualStop
 *
 * If schedStop is in "DUR HH:MM" format, converts it to "MM-DD HH:MM" string
 * based on the given startDate. Used when the scheduler auto-starts a stream
 * so the DB always stores the real stop datetime for the auto-stop check.
 */
function durToActualStop(schedStop: string, startDate: Date): string {
  if (!schedStop || !schedStop.startsWith('DUR ')) return schedStop
  const [hStr, mStr] = schedStop.replace('DUR ', '').split(':')
  const durMins = parseInt(hStr || '0') * 60 + parseInt(mStr || '0')
  if (isNaN(durMins) || durMins <= 0) return schedStop
  const stopAt = new Date(startDate.getTime() + durMins * 60 * 1000)
  return `${String(stopAt.getMonth() + 1).padStart(2, '0')}-${String(stopAt.getDate()).padStart(2, '0')} ${String(stopAt.getHours()).padStart(2, '0')}:${String(stopAt.getMinutes()).padStart(2, '0')}`
}

function calculateNextRun(schedStart: string, daily: boolean, weekly: boolean): string {
  if (!schedStart) return ''
  const now = new Date()
  try {
    const parsed = parseScheduleTime(schedStart)
    if (!parsed) return ''
    const { month, day, hour, minute } = parsed

    if (daily) {
      const nextRun = new Date()
      nextRun.setHours(hour, minute, 0, 0)
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

/**
 * isWithinActiveWindow
 *
 * Returns true if now is inside [schedStart, schedStop).
 * Handles both "MM-DD HH:MM" and "DUR HH:MM" for schedStop.
 *
 * For DUR format: stop = schedStart + duration.
 * Example: schedStart="04-11 00:00", schedStop="DUR 11:45", now=03:00 → TRUE
 */
function isWithinActiveWindow(schedStart: string, schedStop: string): boolean {
  const parsedStart = parseScheduleTime(schedStart)
  if (!parsedStart) return false

  const now = new Date()

  const startDate = normalizeToNow(
    new Date(now.getFullYear(), parsedStart.month - 1, parsedStart.day, parsedStart.hour, parsedStart.minute, 0),
    now
  )

  // For DUR format: compute stop relative to the stored schedStart date
  const stopDate = resolveStopDate(schedStop, startDate, now)
  if (!stopDate) return false

  // We're in the window: start has passed, stop hasn't yet
  const result = startDate <= now && now < stopDate
  console.log(`[Scheduler] isWithinActiveWindow: start=${startDate.toISOString()}, stop=${stopDate.toISOString()}, now=${now.toISOString()}, result=${result}`)
  return result
}

function shouldTrigger(sched: string, slotIndex: number, isStopCheck = false): boolean {
  if (!sched || sched.startsWith('DUR')) return false
  const parsed = parseScheduleTime(sched)
  if (!parsed) {
    console.warn(`[Scheduler] Cannot parse schedule: "${sched}"`)
    return false
  }

  const now = new Date()
  const target = normalizeToNow(
    new Date(now.getFullYear(), parsed.month - 1, parsed.day, parsed.hour, parsed.minute, 0),
    now
  )

  // Pseudo-random deterministic jitter between -150 to +150 seconds
  const seedString = `${sched}_${slotIndex}_${isStopCheck ? 'stop' : 'start'}`
  let hash = 0
  for (let i = 0; i < seedString.length; i++) hash = Math.imul(31, hash) + seedString.charCodeAt(i)
  hash = Math.abs(hash)
  const jitterSecs = (hash % 301) - 150
  target.setSeconds(target.getSeconds() + jitterSecs)

  const diffSecs = Math.floor((now.getTime() - target.getTime()) / 1000)
  // Stop: 5-minute grace window (generous for 15s tick interval)
  // Start: 5-minute exact trigger window
  const graceSecs = 300

  const result = diffSecs >= 0 && diffSecs <= graceSecs
  console.log(`[Scheduler] shouldTrigger(Slot ${slotIndex + 1}, ${isStopCheck ? 'STOP' : 'START'}): sched="${sched}", jitter=${jitterSecs}s, diffSecs=${diffSecs}, target=${target.toLocaleTimeString()}, trigger=${result}`)

  return result
}

// ── Main entry point ────────────────────────────────────────────────────────

export interface SchedulerResult {
  started: number
  stopped: number
  logs: string[]
  timestamp: string
}

export async function runSchedulerTick(): Promise<SchedulerResult> {
  const now = new Date()

  // Distributed lock: prevent concurrent execution across multiple Next.js workers.
  const LOCK_KEY = '__scheduler_last_run__'
  const LOCK_INTERVAL_MS = 10_000

  const lastRunLog = await db.systemLog.findFirst({
    where: { message: { startsWith: LOCK_KEY } },
    orderBy: { timestamp: 'desc' }
  })

  if (lastRunLog) {
    const elapsed = now.getTime() - new Date(lastRunLog.timestamp).getTime()
    if (elapsed < LOCK_INTERVAL_MS) {
      return { started: 0, stopped: 0, logs: [], timestamp: now.toISOString() }
    }
  }

  await db.systemLog.create({ data: { message: `${LOCK_KEY}${now.toISOString()}` } })

  console.log(`[Scheduler] Tick at ${now.toISOString()}`)
  const logs: string[] = []
  let startedCount = 0
  let stoppedCount = 0

  // 1) Fetch currently active streams from Stream Manager
  let activeInManager: Set<number> = new Set()
  let streamManagerResponded = false
  try {
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
    } else {
      console.warn(`[Scheduler] stream-manager /status returned HTTP ${res.status}`)
    }
  } catch (e: any) {
    console.warn(`[Scheduler] Cannot reach stream-manager: ${e.message}`)
  }

  const slots = await db.streamSlot.findMany({
    where: { OR: [{ isScheduled: true }, { isRunning: true }] }
  })

  console.log(`[Scheduler] Found ${slots.length} slot(s) to evaluate`)
  for (const s of slots) {
    console.log(`[Scheduler]   Slot ${s.slotIndex + 1}: isScheduled=${s.isScheduled}, isRunning=${s.isRunning}, schedStart="${s.schedStart}", schedStop="${s.schedStop}"`)
  }

  // Collect slots-to-start separately for sequential processing.
  // Stops are processed inline (must happen before potential next-day re-queue).
  const slotsToStart: typeof slots = []

  for (const slot of slots) {

    // ── Auto-Recovery ───────────────────────────────────────
    if (slot.isRunning && streamManagerResponded && !activeInManager.has(slot.slotIndex)) {
      const missKey = `miss_${slot.slotIndex}`
      const missCount = (missCounters.get(missKey) ?? 0) + 1
      missCounters.set(missKey, missCount)

      if (missCount >= 4) {
        missCounters.set(missKey, 0)

        // Skip recovery if stream ended naturally within 10 min of its schedStop
        let skipRecovery = false
        if (slot.schedStop && !slot.schedStop.startsWith('DUR')) {
          const parsedStop = parseScheduleTime(slot.schedStop)
          if (parsedStop) {
            const stopDate = normalizeToNow(
              new Date(now.getFullYear(), parsedStop.month - 1, parsedStop.day, parsedStop.hour, parsedStop.minute, 0),
              now
            )
            const msSinceStop = now.getTime() - stopDate.getTime()
            if (msSinceStop >= 0 && msSinceStop < 10 * 60 * 1000) {
              skipRecovery = true
              console.log(`[Scheduler] Slot ${slot.slotIndex + 1}: Skipping auto-recovery — ended naturally near schedStop`)
            }
          }
        }

        if (!skipRecovery) {
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
      } else {
        console.log(`[Scheduler] Slot ${slot.slotIndex + 1} not in manager — waiting for confirmation (miss count: ${missCount}/4)`)
      }
    } else if (slot.isRunning && activeInManager.has(slot.slotIndex)) {
      missCounters.set(`miss_${slot.slotIndex}`, 0)
    }

    // ── Auto-Stop ──────────────────────────────────────────
    if (slot.isRunning && slot.schedStop && shouldTrigger(slot.schedStop, slot.slotIndex, true)) {
      try {
        await fetch(`${STREAM_MANAGER_URL}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotIndex: slot.slotIndex })
        })
      } catch {
        logs.push(`Slot ${slot.slotIndex + 1}: Auto-stop failed (stream-manager unreachable) — will retry`)
        await db.systemLog.create({ data: { message: `Slot ${slot.slotIndex + 1}: Auto-stop failed, will retry next tick` } })
        continue
      }

      // Recalculate next start/stop for daily/weekly slots
      let nextStartTime = slot.schedStart || ''
      let nextStopTime = slot.schedStop || ''
      if (slot.daily || slot.weekly) {
        const oldStart = parseScheduleTime(slot.schedStart)
        const oldStop = parseScheduleTime(slot.schedStop)
        if (oldStart && oldStop) {
          let durMins = (oldStop.hour * 60 + oldStop.minute) - (oldStart.hour * 60 + oldStart.minute)
          if (durMins < 0) durMins += 1440
          nextStartTime = calculateNextRun(slot.schedStart, slot.daily, slot.weekly)
          const nParsed = parseScheduleTime(nextStartTime)
          if (nParsed) {
            const nDate = new Date(new Date().getFullYear(), nParsed.month - 1, nParsed.day, nParsed.hour, nParsed.minute)
            nDate.setMinutes(nDate.getMinutes() + durMins)
            nextStopTime = `${String(nDate.getMonth() + 1).padStart(2, '0')}-${String(nDate.getDate()).padStart(2, '0')} ${String(nDate.getHours()).padStart(2, '0')}:${String(nDate.getMinutes()).padStart(2, '0')}`
          }
        }
      }

      const newStatus = slot.daily || slot.weekly ? 'Scheduled' : 'Stopped'
      const claimed = await db.streamSlot.updateMany({
        where: { slotIndex: slot.slotIndex, isRunning: true },
        data: {
          isRunning: false,
          isScheduled: slot.daily || slot.weekly,
          status: newStatus,
          schedStart: nextStartTime,
          schedStop: nextStopTime,
          nextRunTime: nextStartTime
        }
      })
      if (claimed.count === 0) continue
      stoppedCount++
      const stopReason = `schedStop=${slot.schedStop}, daily=${slot.daily}, weekly=${slot.weekly}`
      logs.push(`Slot ${slot.slotIndex + 1}: Auto-stopped (${stopReason}) → nextStart=${nextStartTime}`)
      continue // just stopped — don't also queue for start this tick
    }

    // ── Collect for Sequential Auto-Start ──────────────────
    if (slot.isScheduled && !slot.isRunning && slot.schedStart && slot.streamKey && slot.filePath) {
      // Exact trigger: within 5 minutes of the exact scheduled start time
      const exactTrigger = shouldTrigger(slot.schedStart, slot.slotIndex, false)

      // Window trigger: now is inside [schedStart, schedStop) window
      // Handles both "MM-DD HH:MM" and "DUR HH:MM" schedStop formats
      const withinWindow = slot.schedStop
        ? isWithinActiveWindow(slot.schedStart, slot.schedStop)
        : false

      if (exactTrigger || withinWindow) {
        slotsToStart.push(slot)
        console.log(`[Scheduler] Slot ${slot.slotIndex + 1}: Queued for start (exactTrigger=${exactTrigger}, withinWindow=${withinWindow})`)
      }
    }
  }

  // ── Sequential Start: 1s delay between each slot ───────────────────────
  // stream-manager itself staggers by STAGGER_DELAY_MS=3000ms internally,
  // so combined delay between consecutive stream starts is ~4 seconds.
  for (let i = 0; i < slotsToStart.length; i++) {
    const slot = slotsToStart[i]

    // Convert DUR format to real datetime — anchored to schedStart (not now!)
    // This ensures stop time = original_scheduled_start + duration, regardless of late start
    let actualSchedStop = slot.schedStop
    if (slot.schedStop && slot.schedStop.startsWith('DUR ') && slot.schedStart) {
      const parsedStart = parseScheduleTime(slot.schedStart)
      if (parsedStart) {
        const schedStartDate = normalizeToNow(
          new Date(now.getFullYear(), parsedStart.month - 1, parsedStart.day, parsedStart.hour, parsedStart.minute, 0),
          now
        )
        actualSchedStop = durToActualStop(slot.schedStop, schedStartDate)
      } else {
        actualSchedStop = durToActualStop(slot.schedStop, now)
      }
    }

    // Atomic claim: only proceed if slot is still scheduled and not running
    const claimed = await db.streamSlot.updateMany({
      where: { slotIndex: slot.slotIndex, isRunning: false, isScheduled: true },
      data: {
        isRunning: true,
        isScheduled: false,
        status: 'Streaming',
        ...(actualSchedStop !== slot.schedStop ? { schedStop: actualSchedStop } : {})
      }
    })
    if (claimed.count === 0) {
      console.log(`[Scheduler] Slot ${slot.slotIndex + 1}: Skipped — already claimed by another worker`)
      continue
    }

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
      // Roll back DB claim if stream-manager couldn't be reached
      await db.streamSlot.update({
        where: { slotIndex: slot.slotIndex },
        data: {
          isRunning: false,
          isScheduled: true,
          status: 'Scheduled',
          schedStop: slot.schedStop // restore original DUR format
        }
      })
      logs.push(`Slot ${slot.slotIndex + 1}: Failed to auto-start (rolled back)`)
    }

    // Brief gap between HTTP sends — stream-manager handles the real 1s stagger internally
    if (i < slotsToStart.length - 1) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  for (const log of logs) {
    await db.systemLog.create({ data: { message: log } })
  }

  return { started: startedCount, stopped: stoppedCount, logs, timestamp: now.toISOString() }
}
