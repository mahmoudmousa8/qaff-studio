import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function GET() {
    try {
        const envPath = path.join(process.cwd(), '.env')
        let currentTZ = Intl.DateTimeFormat().resolvedOptions().timeZone

        try {
            const envContent = readFileSync(envPath, 'utf-8')
            const match = envContent.match(/^TZ=(.*)$/m)
            if (match) currentTZ = match[1].trim()
        } catch {
            // Ignore if .env doesn't exist
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

        // 1. Update .env file with new TZ
        const envPath = path.join(process.cwd(), '.env')
        let envContent = ''
        try {
            envContent = readFileSync(envPath, 'utf-8')
        } catch { } // If not exists, create it

        if (envContent.match(/^TZ=.*$/m)) {
            envContent = envContent.replace(/^TZ=.*$/m, `TZ=${timezone}`)
        } else {
            envContent += `\nTZ=${timezone}\n`
        }

        writeFileSync(envPath, envContent.trim() + '\n')

        // 2. Restart Container by escaping the Node process 
        // Docker's restart=always policy will instantly catch the exit and cleanly rebuild the environment
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
