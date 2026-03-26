import { NextResponse } from 'next/server'
import { runSchedulerTick } from '@/lib/run-scheduler'

// GET - Manual trigger / debug endpoint.
// The server-side scheduler calls runSchedulerTick() directly from server-scheduler.ts.
// This endpoint exists only for manual invocation and status reporting.
export async function GET() {
  try {
    const result = await runSchedulerTick()
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[Scheduler API] Error:', error)
    return NextResponse.json({ error: 'Scheduler failed: ' + error.message }, { status: 500 })
  }
}
