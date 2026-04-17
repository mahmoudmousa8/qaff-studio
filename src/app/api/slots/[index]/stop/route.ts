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

    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        isRunning: false,
        manuallyStopped: true,
        // Since the user is manually clicking Stop, we completely abort the schedule.
        // They can edit and click Start again to re-arm the schedule if needed.
        isScheduled: false,
        status: 'Stopped',
        nextRunTime: '',
      }
    })

    return NextResponse.json({
      success: true,
      slot: updatedSlot,
      message: 'Stream stopped and schedule cleared for editing'
    })
  } catch (error) {
    console.error('Error stopping stream:', error)
    return NextResponse.json({ error: 'Failed to stop stream' }, { status: 500 })
  }
}
