import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Reset slot
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)

    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        schedStart: '',
        schedStop: '',
        daily: false,
        weekly: false,
        isScheduled: false,
        isRunning: false,
        nextRunTime: '',
        status: 'Stopped'
      }
    })

    return NextResponse.json({ 
      success: true, 
      slot: updatedSlot,
      message: 'Slot reset'
    })
  } catch (error) {
    console.error('Error resetting slot:', error)
    return NextResponse.json({ error: 'Failed to reset slot' }, { status: 500 })
  }
}
