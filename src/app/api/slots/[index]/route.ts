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

    // Auto-populate filePath from playlistConfig if filePath is missing/empty
    if (updates.playlistConfig && (!updates.filePath || updates.filePath.trim() === '')) {
      try {
        const playlist = JSON.parse(updates.playlistConfig)
        if (Array.isArray(playlist) && playlist.length > 0 && playlist[0]?.videoPath) {
          updates.filePath = playlist[0].videoPath
        }
      } catch (e) {
        console.error('Failed to parse playlistConfig in PUT slot:', e)
      }
    }

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
