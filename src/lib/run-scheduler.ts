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
 * isWithinActiveWindow
 *
 * Returns true if the current time is between schedStart and schedStop.
 * Uses the actual stored dates for precision (handles overnight windows too).
 *
 * Example: schedStart="04-11 12:00", schedStop="04-11 18:00", now=15:00 → true
 *          schedStart="04-12 12:00", schedStop="04-12 18:00", now=15:00 → false (tomorrow)
 */
function isWithinActiveWindow(schedStart: string, schedStop: string): boolean {
  const parsedStart = parseScheduleTime(schedStart)
  const parsedStop = parseScheduleTime(schedStop)
  if (!parsedStart || !parsedStop) return false

  const now = new Date()

  const startDate = normalizeToNow(
    new Date(now.getFullYear(), parsedStart.month - 1, parsedStart.day, parsedStart.hour, parsedStart.minute, 0),
    now
  )
  const stopDate = normalizeToNow(
    new Date(now.getFullYear(), parsedStop.month - 1, parsedStop.day, parsedStop.hour, parsedStop.minute, 0),
    now
  )

  // We're within the window: start has passed AND stop hasn't happened yet
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

  // Pseudo-random deterministic hash based on schedule string and slot index
  const seedString = `${sched}_${slotIndex}_${isStopCheck ? 'stop' : 'start'}`
  let hash = 0
  for (let i = 0; i < seedString.length; i++) hash = Math.imul(31, hash) + seedString.charCodeAt(i)
  hash = Math.abs(hash)

  // Apply deterministic jitter between -150 to +150 seconds
  const jitterSecs = (hash % 301) - 150
  target.setSeconds(target.getSeconds() + jitterSecs)

  const diffSecs = Math.floor((now.getTime() - target.getTime()) / 1000)
  // 60 min stop grace (already running), 5 min start exact trigger
  const graceSecs = isStopCheck ? 3600 : 300

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

  // We collect slots-to-start separately so we can start them sequentially
  // (stops are processed inline first, as they must happen before potential re-queuing)
  const slotsToStart: typeof slots = []

  for (const slot of slots) {

    // ── Auto-Recovery ───────────────────────────────────────
    // Only attempt if stream-manager responded AND slot has been missing 4+ ticks (~60s)
    if (slot.isRunning && streamManagerResponded && !activeInManager.has(slot.slotIndex)) {
      const missKey = `miss_${slot.slotIndex}`
      const missCount = (missCounters.get(missKey) ?? 0) + 1
      missCounters.set(missKey, missCount)

      if (missCount >= 4) {
        missCounters.set(missKey, 0)

        // Skip recovery if the stream recently stopped naturally at its schedStop
        let skipRecovery = false
        if (slot.schedStop) {
          const parsedStop = parseScheduleTime(slot.schedStop)
          if (parsedStop) {
            const stopDate = normalizeToNow(
              new Date(now.getFullYear(), parsedStop.month - 1, parsedStop.day, parsedStop.hour, parsedStop.minute, 0),
              now
            )
            const msSinceStop = now.getTime() - stopDate.getTime()
            // If we are within 10 minutes after the scheduled stop, it ended naturally
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
      // Slot is healthy — reset miss counter
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
      logs.push(`Slot ${slot.slotIndex + 1}: Auto-stopped`)
      continue // slot just stopped — don't also try to start it this tick
    }

    // ── Collect for Sequential Auto-Start ──────────────────
    if (slot.isScheduled && !slot.isRunning && slot.schedStart && slot.streamKey && slot.filePath) {
      // Exact trigger: within 5 minutes of scheduled start time
      const exactTrigger = shouldTrigger(slot.schedStart, slot.slotIndex, false)

      // Window trigger: currently inside the [schedStart, schedStop] window
      // Works for daily/weekly AND one-time schedules that have a stop time set
      const withinWindow = slot.schedStop
        ? isWithinActiveWindow(slot.schedStart, slot.schedStop)
        : false

      if (exactTrigger || withinWindow) {
        slotsToStart.push(slot)
        console.log(`[Scheduler] Slot ${slot.slotIndex + 1}: Queued for sequential start (exactTrigger=${exactTrigger}, withinWindow=${withinWindow})`)
      }
    }
  }

  // ── Sequential Start: 1s delay between each slot ───────────────────────
  // stream-manager itself staggers by STAGGER_DELAY_MS=3000ms internally,
  // so combined delay is ~4 seconds per slot start.
  for (let i = 0; i < slotsToStart.length; i++) {
    const slot = slotsToStart[i]

    // Atomic claim: only proceed if this slot is still scheduled and not running
    const claimed = await db.streamSlot.updateMany({
      where: { slotIndex: slot.slotIndex, isRunning: false, isScheduled: true },
      data: { isRunning: true, isScheduled: false, status: 'Streaming' }
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
        data: { isRunning: false, isScheduled: true, status: 'Scheduled' }
      })
      logs.push(`Slot ${slot.slotIndex + 1}: Failed to auto-start (rolled back)`)
    }

    // 1 second gap between consecutive starts (stream-manager adds another 3s internally)
    if (i < slotsToStart.length - 1) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  for (const log of logs) {
    await db.systemLog.create({ data: { message: log } })
  }

  return { started: startedCount, stopped: stoppedCount, logs, timestamp: now.toISOString() }
}
