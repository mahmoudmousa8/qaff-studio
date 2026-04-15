/**
 * server-scheduler.ts
 *
 * Server-side singleton that calls runSchedulerTick() directly every 60 seconds.
 * No loopback HTTP fetch — the logic lives in lib/run-scheduler.ts.
 *
 * Initialized once via src/instrumentation.ts on server startup.
 */

import { runSchedulerTick } from './run-scheduler'

// Global flag to ensure only one timer is running even with HMR in dev
const g = globalThis as typeof globalThis & { __schedulerStarted?: boolean }

export function startServerScheduler() {
  if (g.__schedulerStarted) return
  g.__schedulerStarted = true

  console.log('[ServerScheduler] Started — fires every 15s (direct, no loopback)')
  tick()
}

async function tick() {
  console.log(`[ServerScheduler] Tick triggered at ${new Date().toISOString()}`)
  try {
    const result = await runSchedulerTick()
    if (result.logs.length > 0) {
      console.log(`[ServerScheduler] Tick result: started=${result.started}, stopped=${result.stopped}, logs=${JSON.stringify(result.logs)}`)
    }
  } catch (err: any) {
    console.error(`[ServerScheduler] Tick failed: ${err.message || String(err)}`)
  } finally {
    // Wait precisely 15 seconds AFTER the current tick finishes to prevent any overlap
    setTimeout(tick, 15_000)
  }
}
