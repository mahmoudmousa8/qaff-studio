import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'

const execAsync = promisify(exec)

export async function GET() {
    try {
        const tzPath = path.join(process.env.APP_DATA_DIR || process.cwd(), 'timezone.txt')
        let currentTZ = Intl.DateTimeFormat().resolvedOptions().timeZone

        try {
            const tzContent = readFileSync(tzPath, 'utf-8').trim()
            if (tzContent) currentTZ = tzContent
        } catch {
            // Ignore if timezone.txt doesn't exist
        }

        return NextResponse.json({ timezone: currentTZ, success: true })
    } catch (error) {
        return NextResponse.json({ error: 'Failed to read timezone' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const { timezone } = await request.json()
        if (!timezone) return NextResponse.json({ error: 'Timezone required' }, { status: 400 })

        // 1. Save timezone to text file in the persistent data volume
        const tzPath = path.join(process.env.APP_DATA_DIR || process.cwd(), 'timezone.txt')
        writeFileSync(tzPath, timezone + '\n')

        // 2. Restart Container by escaping the Node process 
        // Docker's restart=always policy will instantly catch the exit and cleanly rebuild the environment.
        // During restart, stream-manager's new auto-resume feature will 
        // automatically restart any streams that have isRunning=true in the database.
        setTimeout(() => {
            process.exit(0)
        }, 1000)

        return NextResponse.json({
            success: true,
            message: `Timezone updated to ${timezone}. Container restarting to apply changes...`
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
