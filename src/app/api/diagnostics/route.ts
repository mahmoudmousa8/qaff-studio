import { NextResponse } from 'next/server'
import { existsSync, statfsSync } from 'fs'
import { execSync } from 'child_process'
import { db } from '@/lib/db'
import { VIDEOS_DIR, UPLOAD_DIR, DOWNLOAD_DIR, LOGS_DIR, APP_DATA_DIR, STREAM_MANAGER_URL } from '@/lib/paths'

function checkCommand(cmd: string): string | null {
    try {
        const result = execSync(
            process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
            { encoding: 'utf-8', timeout: 3000 }
        ).trim()
        return result.split('\n')[0] || null
    } catch {
        return null
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i]
}

function getDiskUsage(dir: string) {
    try {
        if (!existsSync(dir)) return { total: 0, used: 0, free: 0, usedPercent: 0, freePercent: 0 }
        const stats = statfsSync(dir)
        const total = stats.bsize * stats.blocks
        const free = stats.bsize * stats.bavail
        const used = total - free
        return {
            total, used, free,
            usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
            freePercent: total > 0 ? Math.round((free / total) * 100) : 0
        }
    } catch {
        return { total: 0, used: 0, free: 0, usedPercent: 0, freePercent: 0 }
    }
}

async function checkPort(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
        return res.ok
    } catch {
        return false
    }
}

// GET - Full system diagnostics
export async function GET() {
    try {
        // 1. DB health
        let dbHealthy = false
        let dbSlotCount = 0
        try {
            dbSlotCount = await db.streamSlot.count()
            dbHealthy = true
        } catch { }

        // 2. Stream manager health
        let streamManagerHealthy = false
        let streamManagerData: Record<string, unknown> = {}
        try {
            const res = await fetch(`${STREAM_MANAGER_URL}/health`, { signal: AbortSignal.timeout(3000) })
            if (res.ok) {
                streamManagerData = await res.json()
                streamManagerHealthy = true
            }
        } catch { }

        // 3. ffmpeg / ffprobe
        const ffmpegPath = checkCommand('ffmpeg')
        const ffprobePath = checkCommand('ffprobe')

        // 4. Storage
        const disk = getDiskUsage(VIDEOS_DIR)

        // 5. Port checks
        const port3000 = true // If we're responding, port 3000 is up
        const port3002 = await checkPort(3002)

        // 6. Resolved paths
        const resolvedPaths = {
            APP_DATA_DIR,
            VIDEOS_DIR,
            UPLOAD_DIR,
            DOWNLOAD_DIR,
            LOGS_DIR,
        }

        // 7. Directory existence
        const dirStatus: Record<string, boolean> = {}
        for (const [name, dir] of Object.entries(resolvedPaths)) {
            dirStatus[name] = existsSync(dir)
        }

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            web: {
                status: 'ok',
                port: 3000,
                reachable: port3000
            },
            streamManager: {
                status: streamManagerHealthy ? 'ok' : 'unreachable',
                port: 3002,
                reachable: port3002,
                ...(streamManagerHealthy ? streamManagerData : {})
            },
            database: {
                status: dbHealthy ? 'ok' : 'error',
                slotCount: dbSlotCount
            },
            storage: {
                total: formatBytes(disk.total),
                used: formatBytes(disk.used),
                free: formatBytes(disk.free),
                usedPercent: disk.usedPercent,
                freePercent: disk.freePercent,
                warning: disk.freePercent < 10
            },
            tools: {
                ffmpeg: ffmpegPath ? { available: true, path: ffmpegPath } : { available: false },
                ffprobe: ffprobePath ? { available: true, path: ffprobePath } : { available: false }
            },
            paths: resolvedPaths,
            dirStatus,
            ports: {
                3000: port3000,
                3002: port3002
            }
        })
    } catch (error) {
        console.error('Diagnostics error:', error)
        return NextResponse.json({ error: 'Diagnostics failed' }, { status: 500 })
    }
}
