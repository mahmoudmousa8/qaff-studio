import { NextResponse } from 'next/server'

// GET - Return current server time for clock display
export async function GET() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  return NextResponse.json({
    hours: pad(now.getHours()),
    minutes: pad(now.getMinutes()),
    seconds: pad(now.getSeconds()),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    iso: now.toISOString()
  })
}
