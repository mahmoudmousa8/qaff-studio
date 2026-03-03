import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STREAM_MANAGER_URL } from '@/lib/paths'

// GET - Reconcile stream states between DB and stream-manager
export async function GET() {
    try {
        // Get active streams from stream-manager
        let managerActiveSlots: number[] = []
        let managerReachable = false

        try {
            const res = await fetch(`${STREAM_MANAGER_URL}/status`, { signal: AbortSignal.timeout(2000) })
            if (res.ok) {
                const data = await res.json()
                managerActiveSlots = data.activeStreams || []
                managerReachable = true
            }
        } catch { }

        // Get all slots that think they are running
        const dbRunningSlots = await db.streamSlot.findMany({
            where: { isRunning: true },
            select: { slotIndex: true, status: true }
        })

        // Get all slots that are in Starting state
        const dbStartingSlots = await db.streamSlot.findMany({
            where: { status: 'Starting' },
            select: { slotIndex: true }
        })

        const reconciled: { slotIndex: number; action: string }[] = []

        if (managerReachable) {
            // Fix slots that DB says are running but stream-manager says they are not
            for (const dbSlot of dbRunningSlots) {
                if (!managerActiveSlots.includes(dbSlot.slotIndex)) {
                    await db.streamSlot.update({
                        where: { slotIndex: dbSlot.slotIndex },
                        data: { isRunning: false, status: 'Stopped' }
                    })
                    reconciled.push({ slotIndex: dbSlot.slotIndex, action: 'stopped (not in manager)' })
                }
            }

            // Fix slots that stream-manager says are running but DB doesn't
            for (const activeSlot of managerActiveSlots) {
                const dbSlot = dbRunningSlots.find(s => s.slotIndex === activeSlot)
                if (!dbSlot) {
                    await db.streamSlot.update({
                        where: { slotIndex: activeSlot },
                        data: { isRunning: true, status: 'Streaming' }
                    })
                    reconciled.push({ slotIndex: activeSlot, action: 'set to streaming (found in manager)' })
                }
            }

            // Fix Starting slots that are actually running
            for (const startingSlot of dbStartingSlots) {
                if (managerActiveSlots.includes(startingSlot.slotIndex)) {
                    await db.streamSlot.update({
                        where: { slotIndex: startingSlot.slotIndex },
                        data: { isRunning: true, status: 'Streaming' }
                    })
                    reconciled.push({ slotIndex: startingSlot.slotIndex, action: 'Starting → Streaming' })
                }
            }
        }

        return NextResponse.json({
            managerReachable,
            activeStreams: managerActiveSlots,
            activeCount: managerActiveSlots.length,
            reconciled,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        console.error('Status reconciliation error:', error)
        return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
    }
}
