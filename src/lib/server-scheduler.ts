/**
 * server-scheduler.ts
 * 
 * A server-side singleton that runs the scheduler on a 60-second interval
 * inside the Next.js Node.js process. This replaces the browser-side setInterval
 * and eliminates race conditions from multiple browser tabs calling /api/scheduler.
 * 
 * Initialized once via src/instrumentation.ts on server startup.
 */

// Global flag to ensure only one timer is running even with HMR in dev
const g = globalThis as typeof globalThis & { __schedulerStarted?: boolean }

export function startServerScheduler() {
  if (g.__schedulerStarted) return
  g.__schedulerStarted = true

  console.log('[ServerScheduler] Started — fires every 60s')

  // Fire immediately on boot, then every 60 seconds
  runSchedulerTick()
  setInterval(runSchedulerTick, 60_000)
}

async function runSchedulerTick() {
  try {
    // Call our own scheduler API internally so all logic stays in one place
    // This is a loopback fetch using the same host
    const baseUrl = process.env.NEXTAUTH_URL
      || process.env.NEXT_PUBLIC_BASE_URL
      || 'http://localhost:3000'

    await fetch(`${baseUrl}/api/scheduler`, {
      cache: 'no-store',
      headers: { 'X-Internal-Scheduler': '1' }
    })
  } catch {
    // Silent — scheduler will retry next tick
  }
}
