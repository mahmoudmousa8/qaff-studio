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
// Requires 2 missed ticks before triggering auto-recovery to prevent spurious restarts.
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

function shouldTrigger(sched: string, isStopCheck = false): boolean {
  if (!sched || sched.startsWith('DUR')) return false
  const now = new Date()
  const parsed = parseScheduleTime(sched)
  if (!parsed) {
    console.warn(`[Scheduler] Cannot parse schedule: "${sched}"`)
    return false
  }
  const targetDate = new Date(now.getFullYear(), parsed.month - 1, parsed.day, parsed.hour, parsed.minute)
  const diffMins = Math.floor((now.getTime() - targetDate.getTime()) / 60000)
  const grace = isStopCheck ? 60 : 5
  const result = diffMins >= 0 && diffMins <= grace
  console.log(`[Scheduler] shouldTrigger("${sched}", stop=${isStopCheck}): now=${now.toISOString()}, target=${targetDate.toISOString()}, diffMins=${diffMins}, grace=${grace}, trigger=${result}`)
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

  // ── Distributed lock: prevent concurrent execution across multiple Next.js workers ──
  // Check the last scheduler run time stored in DB. If it ran less than 55s ago, skip.
  const LOCK_KEY = '__scheduler_last_run__'
  const LOCK_INTERVAL_MS = 55_000

  const lastRunLog = await db.systemLog.findFirst({
    where: { message: { startsWith: LOCK_KEY } },
    orderBy: { timestamp: 'desc' }
  })

  if (lastRunLog) {
    const elapsed = now.getTime() - new Date(lastRunLog.timestamp).getTime()
    if (elapsed < LOCK_INTERVAL_MS) {
      // Another worker already ran recently — skip silently
      return { started: 0, stopped: 0, logs: [], timestamp: now.toISOString() }
    }
  }

  // Claim the lock by writing timestamp immediately
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

  for (const slot of slots) {


    // ── Auto-Recovery ───────────────────────────────────────
    // IMPORTANT: Only attempt auto-recovery if stream-manager responded AND
    // the slot has been missing for 2 consecutive ticks (dead-zone protection).
    // This prevents spurious restarts caused by brief stream-manager reporting gaps.
    if (slot.isRunning && streamManagerResponded && !activeInManager.has(slot.slotIndex)) {
      const missKey = `miss_${slot.slotIndex}`
      const missCount = (missCounters.get(missKey) ?? 0) + 1
      missCounters.set(missKey, missCount)

      if (missCount >= 2) {
        // Slot confirmed missing for 2 consecutive ticks — safe to attempt recovery
        missCounters.set(missKey, 0)
        try {
          const res = await fetch(`${STREAM_MANAGER_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotIndex: slot.slotIndex, outputType: slot.outputType, rtmpServer: slot.rtmpServer, streamKey: slot.streamKey, filePath: slot.filePath })
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
      } else {
        console.log(`[Scheduler] Slot ${slot.slotIndex + 1} not in manager — waiting for confirmation (miss count: ${missCount}/2)`)
      }
    } else if (slot.isRunning && activeInManager.has(slot.slotIndex)) {
      // Slot is healthy — reset miss counter
      missCounters.set(`miss_${slot.slotIndex}`, 0)
    }

    // ── Auto-Start ──────────────────────────────────────────
    if (slot.isScheduled && !slot.isRunning && slot.schedStart && slot.streamKey && slot.filePath) {
      if (shouldTrigger(slot.schedStart)) {
        const claimed = await db.streamSlot.updateMany({
          where: { slotIndex: slot.slotIndex, isRunning: false, isScheduled: true },
          data: { isRunning: true, isScheduled: false, status: 'Streaming' }
        })
        if (claimed.count === 0) continue

        try {
          await fetch(`${STREAM_MANAGER_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotIndex: slot.slotIndex, outputType: slot.outputType, rtmpServer: slot.rtmpServer, streamKey: slot.streamKey, filePath: slot.filePath })
          })
          startedCount++
          logs.push(`Slot ${slot.slotIndex + 1}: Auto-started`)
        } catch {
          await db.streamSlot.update({
            where: { slotIndex: slot.slotIndex },
            data: { isRunning: false, isScheduled: true, status: 'Scheduled' }
          })
          logs.push(`Slot ${slot.slotIndex + 1}: Failed to auto-start (rolled back)`)
        }
      }
    }

    // ── Auto-Stop ──────────────────────────────────────────
    if (slot.isRunning && slot.schedStop && shouldTrigger(slot.schedStop, true)) {
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
        data: { isRunning: false, isScheduled: slot.daily || slot.weekly, status: newStatus, schedStart: nextStartTime, schedStop: nextStopTime, nextRunTime: nextStartTime }
      })
      if (claimed.count === 0) continue
      stoppedCount++
      logs.push(`Slot ${slot.slotIndex + 1}: Auto-stopped`)
    }
  }

  for (const log of logs) {
    await db.systemLog.create({ data: { message: log } })
  }

  return { started: startedCount, stopped: stoppedCount, logs, timestamp: now.toISOString() }
}
