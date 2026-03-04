import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULT_RTMP = "rtmp://a.rtmp.youtube.com/live2"
const TOTAL_SLOTS = parseInt(process.env.TOTAL_SLOTS || '50', 10)


// GET - Fetch slots with pagination
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    // Ensure all slots exist
    const existingCount = await db.streamSlot.count()

    if (existingCount < TOTAL_SLOTS) {
      // Create missing slots
      const slotsToCreate: any[] = []
      for (let i = existingCount; i < TOTAL_SLOTS; i++) {
        slotsToCreate.push({
          slotIndex: i,
          rtmpServer: DEFAULT_RTMP,
          outputType: 'youtube',
        })

      }

      if (slotsToCreate.length > 0) {
        await db.streamSlot.createMany({
          data: slotsToCreate
        })
      }
    } else if (existingCount > TOTAL_SLOTS) {
      // User reduced the TOTAL_SLOTS limit — delete the excess slots from DB
      await db.streamSlot.deleteMany({
        where: {
          slotIndex: {
            gte: TOTAL_SLOTS
          }
        }
      })
    }

    const slots = await db.streamSlot.findMany({
      skip,
      take: limit,
      orderBy: { slotIndex: 'asc' }
    })

    const total = await db.streamSlot.count()

    return NextResponse.json({ slots, total })
  } catch (error) {
    console.error('Error fetching slots:', error)
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 })
  }
}
