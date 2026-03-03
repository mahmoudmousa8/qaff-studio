import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get overall stats
export async function GET() {
  try {
    const total = await db.streamSlot.count()
    
    const streaming = await db.streamSlot.count({
      where: { status: 'Streaming' }
    })
    
    const scheduled = await db.streamSlot.count({
      where: { status: 'Scheduled' }
    })
    
    const stopped = await db.streamSlot.count({
      where: { status: 'Stopped' }
    })
    
    const completed = await db.streamSlot.count({
      where: { status: 'Completed' }
    })
    
    const configured = await db.streamSlot.count({
      where: {
        streamKey: { not: '' },
        filePath: { not: '' }
      }
    })
    
    const dailyCount = await db.streamSlot.count({
      where: { daily: true }
    })
    
    const weeklyCount = await db.streamSlot.count({
      where: { weekly: true }
    })

    return NextResponse.json({
      total,
      streaming,
      scheduled,
      stopped,
      completed,
      configured,
      dailyCount,
      weeklyCount
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
