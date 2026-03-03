import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// POST - Stop streaming
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)

    // Validate slotIndex
    if (isNaN(slotIndex) || slotIndex < 0) {
      return NextResponse.json({ error: 'Invalid slot index' }, { status: 400 })
    }

    const slot = await db.streamSlot.findUnique({
      where: { slotIndex }
    })

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
    }

    // Call the stream manager to stop FFmpeg
    try {
      await fetch(`${STREAM_MANAGER_URL}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIndex })
      })
    } catch (error) {
      console.error('Failed to connect to stream manager:', error)
    }

    let newStatus = 'Stopped'
    let isScheduled = false

    // If was scheduled and has recurring schedule
    if (slot.isScheduled && (slot.daily || slot.weekly)) {
      newStatus = 'Completed'
      isScheduled = true
    }

    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        isRunning: false,
        isScheduled,
        status: newStatus
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
