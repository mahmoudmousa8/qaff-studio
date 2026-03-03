import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT - Update a slot
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)
    const updates = await request.json()

    const slot = await db.streamSlot.update({
      where: { slotIndex },
      data: updates
    })

    return NextResponse.json(slot)
  } catch (error) {
    console.error('Error updating slot:', error)
    return NextResponse.json({ error: 'Failed to update slot' }, { status: 500 })
  }
}
