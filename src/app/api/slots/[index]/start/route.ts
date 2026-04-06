import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// POST - Start streaming
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)

    if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= 500) {
      return NextResponse.json({ error: 'Invalid slot index' }, { status: 400 })
    }

    const slot = await db.streamSlot.findUnique({
      where: { slotIndex }
    })

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
    }

    if (!slot.filePath) {
      return NextResponse.json({ error: 'fileNotFound' }, { status: 400 })
    }

    const outputType = slot.outputType || 'youtube'

    // Validate based on output type
    if (outputType === 'youtube' || outputType === 'facebook') {
      if (!slot.streamKey || slot.streamKey.trim() === '') {
        return NextResponse.json({ error: 'streamKeyRequired' }, { status: 400 })
      }
    } else {
      // tiktok / custom: rtmpServer must be a valid RTMP URL
      if (!slot.rtmpServer || (!slot.rtmpServer.startsWith('rtmp://') && !slot.rtmpServer.startsWith('rtmps://'))) {
        return NextResponse.json({ error: 'invalidRtmpUrl' }, { status: 400 })
      }
    }

    let updatedSchedStart = slot.schedStart;
    if (!updatedSchedStart && (slot.daily || slot.weekly)) {
      const now = new Date();
      const sMonth = String(now.getMonth() + 1).padStart(2, '0');
      const sDate = String(now.getDate()).padStart(2, '0');
      const sH = String(now.getHours()).padStart(2, '0');
      const sM = String(now.getMinutes()).padStart(2, '0');
      updatedSchedStart = `${sMonth}-${sDate} ${sH}:${sM}`;
    }

    let updatedSchedStop = slot.schedStop;
    if (updatedSchedStop && updatedSchedStop.startsWith('DUR ')) {
      const [hStr, mStr] = updatedSchedStop.replace('DUR ', '').split(':');
      const dursMins = parseInt(hStr || '0') * 60 + parseInt(mStr || '0');
      if (dursMins > 0) {
        const targetDate = new Date();
        targetDate.setMinutes(targetDate.getMinutes() + dursMins);
        const fMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
        const fDate = String(targetDate.getDate()).padStart(2, '0');
        const fH = String(targetDate.getHours()).padStart(2, '0');
        const fM = String(targetDate.getMinutes()).padStart(2, '0');
        updatedSchedStop = `${fMonth}-${fDate} ${fH}:${fM}`;
      }
    }

    // Set status to Starting
    await db.streamSlot.update({
      where: { slotIndex },
      data: {
        status: 'Starting',
        isRunning: false,
        isScheduled: false,
        schedStart: updatedSchedStart,
        schedStop: updatedSchedStop
      }
    })

    // Call stream manager
    try {
      const response = await fetch(`${STREAM_MANAGER_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotIndex,
          outputType,
          rtmpServer: slot.rtmpServer,
          streamKey: slot.streamKey,
          filePath: slot.filePath
        })
      })

      const result = await response.json()

      if (!result.success) {
        await db.streamSlot.update({
          where: { slotIndex },
          data: { status: 'Failed', isRunning: false }
        })
        return NextResponse.json({ error: result.message }, { status: 400 })
      }

      const updatedSlot = await db.streamSlot.update({
        where: { slotIndex },
        data: {
          isRunning: true,
          isScheduled: false,
          status: 'Streaming'
        }
      })

      return NextResponse.json({
        success: true,
        slot: updatedSlot,
        message: result.message || 'streamRunning'
      })
    } catch (error) {
      console.error('Failed to connect to stream manager:', error)
      await db.streamSlot.update({
        where: { slotIndex },
        data: { status: 'Failed', isRunning: false }
      })
      return NextResponse.json({ error: 'Stream manager not available' }, { status: 503 })
    }
  } catch (error) {
    console.error('Error starting stream:', error)
    return NextResponse.json({ error: 'streamFailed' }, { status: 500 })
  }
}
