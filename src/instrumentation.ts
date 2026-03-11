/**
 * instrumentation.ts
 * 
 * Next.js calls this file ONCE when the server process starts.
 * We use it to bootstrap the server-side scheduler singleton so the cron
 * runs entirely on the server, independent of any browser tabs being open.
 * 
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startServerScheduler } = await import('./lib/server-scheduler')
    startServerScheduler()
  }
}
