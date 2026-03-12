import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// POST - Manual Stop streaming
// Always cancels all scheduled state. If the user explicitly stops,
// they want everything stopped — not just paused until the next run.
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

    // Manual stop always cancels scheduling entirely (user explicitly chose to stop)
    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        isRunning: false,
        isScheduled: false,
        status: 'Stopped',
        nextRunTime: ''
      }
    })

    return NextResponse.json({
      success: true,
      slot: updatedSlot,
      message: 'Stream stopped'
    })
  } catch (error) {
    console.error('Error stopping stream:', error)
    return NextResponse.json({ error: 'Failed to stop stream' }, { status: 500 })
  }
}
