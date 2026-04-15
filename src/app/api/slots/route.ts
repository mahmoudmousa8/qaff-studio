import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import Database from 'better-sqlite3'

// NOTE: We attempt to patch the DB if manuallyStopped is missing because sometimes docker-entrypoint fails
try {
  let dbPath = (process.env.DATABASE_URL || '').replace(/^file:/, '')
  if (dbPath) {
    const sdb = new Database(dbPath)
    try {
      
      const tableInfo = sdb.prepare("PRAGMA table_info(StreamSlot)").all() as any[];
      const hasColumn = tableInfo.some(c => c.name === 'manuallyStopped');
      if (!hasColumn) {
        sdb.exec("ALTER TABLE StreamSlot ADD COLUMN manuallyStopped INTEGER NOT NULL DEFAULT 1;")
        console.log('[Safe-Migrate] Added manuallyStopped column to StreamSlot via Next.js')
      }
    } catch(e) { }
    sdb.close()
  }
} catch (e) {
  console.log('[Safe-Migrate] Skipped:', e)
}

const DEFAULT_RTMP = "rtmp://a.rtmp.youtube.com/live2"
// NOTE: Read at request time — not module load time — to pick up runtime env vars


// GET - Fetch slots with pagination
export async function GET(request: NextRequest) {
  const TOTAL_SLOTS = parseInt(process.env.TOTAL_SLOTS || '50', 10)
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '100')
  const search = searchParams.get('search') || ''
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

    const whereClause: any = search
      ? { channelName: { contains: search } }
      : {}

    const slots = await db.streamSlot.findMany({
      skip,
      take: limit,
      where: whereClause,
      orderBy: { slotIndex: 'asc' }
    })

    const total = await db.streamSlot.count({
      where: whereClause
    })

    return NextResponse.json({ slots, total })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Error fetching slots:', msg)
    return NextResponse.json({ error: 'Failed to fetch slots', detail: msg, dbUrl: process.env.DATABASE_URL, cwd: process.cwd() }, { status: 500 })
  }
}
