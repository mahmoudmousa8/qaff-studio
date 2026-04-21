import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

const BULK_STREAM_MANAGER = STREAM_MANAGER_URL

// POST - Bulk operations
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json()

    switch (action) {
      case 'startAll': {
        // Start all configured slots IN PARALLEL — all fire at the same instant
        const slots = await db.streamSlot.findMany({
          where: {
            streamKey: { not: '' },
            filePath: { not: '' },
            isRunning: false
          }
        })

        // Phase 1: Mark all as "Starting" in DB simultaneously
        await Promise.all(slots.map(async (slot) => {
          let updatedSchedStart = slot.schedStart;
          if (!updatedSchedStart) {
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

          await db.streamSlot.update({
            where: { slotIndex: slot.slotIndex },
            data: { status: 'Starting', isRunning: false, manuallyStopped: false, schedStart: updatedSchedStart, schedStop: updatedSchedStop }
          })

          // Attach resolved times to slot for phase 2
          ;(slot as any)._resolvedStart = updatedSchedStart
          ;(slot as any)._resolvedStop = updatedSchedStop
        }))

        // Phase 2: Fire ALL stream-manager start requests simultaneously
        const results = await Promise.allSettled(slots.map(async (slot) => {
          const response = await fetch(`${BULK_STREAM_MANAGER}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slotIndex: slot.slotIndex,
              rtmpServer: slot.rtmpServer,
              streamKey: slot.streamKey,
              filePath: slot.filePath
            })
          })
          const result = await response.json()

          if (result.success) {
            await db.streamSlot.update({
              where: { slotIndex: slot.slotIndex },
              data: { isRunning: true, isScheduled: false, status: 'Streaming' }
            })
            return { success: true, slotIndex: slot.slotIndex }
          } else {
            await db.streamSlot.update({
              where: { slotIndex: slot.slotIndex },
              data: { status: 'Failed', isRunning: false }
            })
            return { success: false, slotIndex: slot.slotIndex, message: result.message }
          }
        }))

        let count = 0
        const errors: string[] = []
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.success) {
            count++
          } else if (r.status === 'fulfilled' && !r.value.success) {
            errors.push(`Slot ${r.value.slotIndex + 1}: ${r.value.message}`)
          } else if (r.status === 'rejected') {
            errors.push(`Slot: Stream manager error`)
          }
        }

        return NextResponse.json({
          success: true,
          count,
          errors: errors.length > 0 ? errors : undefined,
          message: `Started ${count} slots in parallel`
        })
      }


      case 'stopAll': {
        // Stop all via stream manager first
        try {
          await fetch(`${BULK_STREAM_MANAGER}/stop-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
        } catch {
          // Continue even if stream manager is down
        }

        const result = await db.streamSlot.updateMany({
          where: { isRunning: true },
          data: {
            isRunning: false,
            isScheduled: false,
            manuallyStopped: true,
            status: 'Stopped',
            nextRunTime: '',
          }
        })

        return NextResponse.json({ success: true, count: result.count, message: `Stopped ${result.count} slots` })
      }

      case 'setTimeAll': {
        // Set alternating AM/PM schedule for empty slots
        // slotIndex % 2 === 0 → AM (next midnight 00:00)
        // slotIndex % 2 === 1 → PM (nearest noon 12:00)
        const now = new Date()

        const slots = await db.streamSlot.findMany({
          where: { schedStart: '' },
          orderBy: { slotIndex: 'asc' }
        })

        for (const slot of slots) {
          const isAM = slot.slotIndex % 2 === 0 // even index → AM

          let target: Date
          if (isAM) {
            // Next midnight (always tomorrow at 00:00)
            target = new Date(now)
            target.setDate(target.getDate() + 1)
            target.setHours(0, 0, 0, 0)
          } else {
            // Nearest noon — today if not yet 12, else tomorrow
            target = new Date(now)
            if (now.getHours() >= 12) {
              target.setDate(target.getDate() + 1)
            }
            target.setHours(12, 0, 0, 0)
          }

          const fmt = (d: Date) =>
            `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

          const startTime = fmt(target)
          const stopDate = new Date(target.getTime() + 11 * 60 * 60 * 1000 + 45 * 60 * 1000)
          const stopTime = fmt(stopDate)

          await db.streamSlot.update({
            where: { slotIndex: slot.slotIndex },
            data: { schedStart: startTime, schedStop: stopTime }
          })
        }

        return NextResponse.json({ success: true, count: slots.length, message: `Set alternating AM/PM schedule for ${slots.length} empty slots` })
      }

      case 'dailyAll': {
        // Toggle daily for all slots
        const dailyCount = await db.streamSlot.count({
          where: { daily: true }
        })
        const total = await db.streamSlot.count()
        const targetState = dailyCount < total / 2

        const result = await db.streamSlot.updateMany({
          data: {
            daily: targetState,
            weekly: false
          }
        })

        const actionText = targetState ? 'Enabled' : 'Disabled'
        return NextResponse.json({ success: true, count: result.count, message: `${actionText} Daily for all slots` })
      }

      case 'resetAll': {
        // Stop all streams first
        try {
          await fetch(`${BULK_STREAM_MANAGER}/stop-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
        } catch {
          // Continue even if stream manager is down
        }

        const result = await db.streamSlot.updateMany({
          data: {
            channelName: '',
            filePath: '',
            streamKey: '',
            schedStart: '',
            schedStop: '',
            daily: false,
            weekly: false,
            isScheduled: false,
            isRunning: false,
            manuallyStopped: true,
            nextRunTime: '',
            status: 'Stopped'
          }
        })

        return NextResponse.json({ success: true, count: result.count, message: `Reset ${result.count} slots` })
      }

      case 'scheduleAll': {
        // Schedule all configured slots (have key + file + schedStart) that aren't already running
        const slots = await db.streamSlot.findMany({
          where: {
            streamKey: { not: '' },
            filePath: { not: '' },
            schedStart: { not: '' },
            isRunning: false,
            isScheduled: false,
          }
        })

        const errors: string[] = []
        let count = 0

        for (const slot of slots) {
          try {
            await db.streamSlot.update({
              where: { slotIndex: slot.slotIndex },
              data: { isScheduled: true, status: 'Scheduled' }
            })
            count++
          } catch {
            errors.push(`Slot ${slot.slotIndex + 1}: Failed to schedule`)
          }
        }

        return NextResponse.json({
          success: true, count, errors: errors.length > 0 ? errors : undefined,
          message: `Scheduled ${count} slots`
        })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error in bulk operation:', error)
    return NextResponse.json({ error: 'Failed to perform operation' }, { status: 500 })
  }
}
