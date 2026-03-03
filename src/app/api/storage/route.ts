import { NextResponse } from 'next/server'
import { statfsSync } from 'fs'
import { existsSync } from 'fs'
import { VIDEOS_DIR, APP_DATA_DIR } from '@/lib/paths'

function getDiskUsage(dir: string) {
    try {
        if (!existsSync(dir)) {
            return { total: 0, used: 0, free: 0, usedPercent: 0, freePercent: 0 }
        }
        const stats = statfsSync(dir)
        const total = stats.bsize * stats.blocks
        const free = stats.bsize * stats.bavail
        const used = total - free
        const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0
        const freePercent = total > 0 ? Math.round((free / total) * 100) : 0
        return { total, used, free, usedPercent, freePercent }
    } catch {
        return { total: 0, used: 0, free: 0, usedPercent: 0, freePercent: 0 }
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i]
}

// GET - Get storage usage
export async function GET() {
    try {
        const disk = getDiskUsage(VIDEOS_DIR)
        const LOW_THRESHOLD_PERCENT = 10
        const LOW_THRESHOLD_GB = 5

        const freeGB = disk.free / (1024 * 1024 * 1024)
        const warning = disk.freePercent < LOW_THRESHOLD_PERCENT || freeGB < LOW_THRESHOLD_GB

        return NextResponse.json({
            total: disk.total,
            used: disk.used,
            free: disk.free,
            usedPercent: disk.usedPercent,
            freePercent: disk.freePercent,
            totalFormatted: formatBytes(disk.total),
            usedFormatted: formatBytes(disk.used),
            freeFormatted: formatBytes(disk.free),
            warning,
            warningMessage: warning
                ? `Low storage! Only ${formatBytes(disk.free)} (${disk.freePercent}%) free.`
                : null,
            videosDir: VIDEOS_DIR,
            dataDir: APP_DATA_DIR
        })
    } catch (error) {
        console.error('Error getting storage:', error)
        return NextResponse.json({ error: 'Failed to get storage info' }, { status: 500 })
    }
}
