import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

function calculateNextRun(schedStart: string, daily: boolean, weekly: boolean): string {
  if (!schedStart) return ''
  
  const now = new Date()
  
  try {
    const parts = schedStart.split(' ')
    if (parts.length !== 2) return ''
    
    const [datePart, timePart] = parts
    const [month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    
    if (daily) {
      let nextRun = new Date()
      nextRun.setHours(hour, minute, 0, 0)
      
      if (now >= nextRun) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
      
      return `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
    }
    
    if (weekly) {
      // Get reference weekday
      const refDate = new Date(now.getFullYear(), month - 1, day, hour, minute)
      const targetWeekday = refDate.getDay()
      
      let daysAhead = (targetWeekday - now.getDay() + 7) % 7
      if (daysAhead === 0 && now >= refDate) {
        daysAhead = 7
      }
      
      const nextRun = new Date(now)
      nextRun.setDate(nextRun.getDate() + daysAhead)
      nextRun.setHours(hour, minute, 0, 0)
      
      return `${String(nextRun.getMonth() + 1).padStart(2, '0')}-${String(nextRun.getDate()).padStart(2, '0')} ${String(nextRun.getHours()).padStart(2, '0')}:${String(nextRun.getMinutes()).padStart(2, '0')}`
    }
    
    return schedStart
  } catch {
    return ''
  }
}

// POST - Schedule streaming
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index } = await params
    const slotIndex = parseInt(index)

    const slot = await db.streamSlot.findUnique({
      where: { slotIndex }
    })

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
    }

    if (!slot.schedStart) {
      return NextResponse.json({ error: 'Please set start schedule time' }, { status: 400 })
    }

    if (!slot.streamKey || !slot.filePath) {
      return NextResponse.json({ error: 'Please fill Key and File Path' }, { status: 400 })
    }

    const nextRunTime = calculateNextRun(slot.schedStart, slot.daily, slot.weekly)

    const updatedSlot = await db.streamSlot.update({
      where: { slotIndex },
      data: {
        isScheduled: true,
        status: 'Scheduled',
        nextRunTime
      }
    })

    return NextResponse.json({ 
      success: true, 
      slot: updatedSlot,
      message: 'Stream scheduled'
    })
  } catch (error) {
    console.error('Error scheduling stream:', error)
    return NextResponse.json({ error: 'Failed to schedule stream' }, { status: 500 })
  }
}
