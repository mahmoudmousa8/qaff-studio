import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const LOG_LIMIT = 500

// Internal lock prefix used by the scheduler — never shown to users
const INTERNAL_PREFIX = '__scheduler_last_run__'

// TTL cleanup function - delete logs older than 12 hours + always purge internal lock messages
async function cleanupOldLogs() {
  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    await db.systemLog.deleteMany({
      where: {
        OR: [
          { timestamp: { lt: twelveHoursAgo } },
          { message: { startsWith: INTERNAL_PREFIX } }
        ]
      }
    })
  } catch (error) {
    console.error('Log cleanup error:', error)
  }
}

// GET - Fetch logs, optionally filtered by slotIndex
export async function GET(request: NextRequest) {
  try {
    // Run TTL cleanup periodically (10% chance per request)
    if (Math.random() < 0.1) {
      cleanupOldLogs()
    }

    const slotIndexParam = request.nextUrl.searchParams.get('slotIndex')
    const slotIndex = slotIndexParam !== null ? parseInt(slotIndexParam) : null

    let logs
    if (slotIndex !== null && !isNaN(slotIndex)) {
      // Filter logs for specific slot (matches "Slot N:" prefix)
      const slotPrefix = `Slot ${slotIndex + 1}:`
      logs = await db.systemLog.findMany({
        take: 100,
        orderBy: { timestamp: 'desc' },
        where: {
          message: { startsWith: slotPrefix },
          NOT: { message: { startsWith: INTERNAL_PREFIX } }
        }
      })
    } else {
      logs = await db.systemLog.findMany({
        take: LOG_LIMIT,
        orderBy: { timestamp: 'desc' },
        where: {
          NOT: { message: { startsWith: INTERNAL_PREFIX } }
        }
      })
    }

    return NextResponse.json({ logs: logs.reverse() })
  } catch (error) {
    console.error('Error fetching logs:', error)
    return NextResponse.json({ logs: [] })
  }
}

// POST - Add log
export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()

    // Validate message
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    // Limit message length
    const trimmedMessage = message.substring(0, 500)

    const log = await db.systemLog.create({
      data: { message: trimmedMessage }
    })

    return NextResponse.json({ success: true, log })
  } catch (error) {
    console.error('Error adding log:', error)
    return NextResponse.json({ error: 'Failed to add log' }, { status: 500 })
  }
}

// DELETE - Clear all logs manually
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const clearAll = url.searchParams.get('all') === 'true';

    if (clearAll) {
      await db.systemLog.deleteMany({})
      return NextResponse.json({ success: true, message: 'All logs cleared' })
    } else {
      await cleanupOldLogs()
      return NextResponse.json({ success: true, message: 'Old logs cleaned up' })
    }
  } catch (error) {
    console.error('Error cleaning up logs:', error)
    return NextResponse.json({ error: 'Failed to cleanup logs' }, { status: 500 })
  }
}
