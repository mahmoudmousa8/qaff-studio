import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

import { NextRequest } from 'next/server'

// GET - Return current server time for clock display and datetime pickers
export async function GET(request: NextRequest) {
  const addMins = parseInt(request.nextUrl.searchParams.get('addMinutes') || '0')
  const now = new Date(Date.now() + addMins * 60000)

  // Find the exact timezone the client chose
  let currentTZ = Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    const tzPath = path.join(process.env.APP_DATA_DIR || process.cwd(), 'timezone.txt')
    const tzContent = readFileSync(tzPath, 'utf-8').trim()
    if (tzContent) currentTZ = tzContent
  } catch {
    // Ignore if timezone.txt doesn't exist, fallback to system TZ
  }

  // Format time strictly in the selected timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: currentTZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  // en-GB format is DD/MM/YYYY, HH:mm:ss
  const formattedString = formatter.format(now)
  const [datePart, timePart] = formattedString.split(', ')
  const [day, month, year] = datePart.split('/')
  const [hours, minutes, seconds] = timePart.split(':')

  return NextResponse.json({
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    time: timePart,
    date: datePart,
    timezone: currentTZ,
    iso: now.toISOString()
  })
}
