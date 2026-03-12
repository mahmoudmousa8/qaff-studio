import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

// GET - Return current server time for clock display
export async function GET() {
  const now = new Date()

  // Find the exact timezone the client chose
  let currentTZ = Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    const envPath = path.join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    const match = envContent.match(/^TZ=(.*)$/m)
    if (match) currentTZ = match[1].trim()
  } catch {
    // Ignore if .env doesn't exist, fallback to system TZ
  }

  // Format time strictly in the selected timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: currentTZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const timeString = formatter.format(now) // HH:mm:ss
  const [hours, minutes, seconds] = timeString.split(':')

  return NextResponse.json({
    hours,
    minutes,
    seconds,
    time: timeString,
    timezone: currentTZ,
    iso: now.toISOString()
  })
}
