import { NextResponse } from 'next/server'
import { statSync, readdirSync } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import { VIDEOS_DIR, APP_DATA_DIR } from '@/lib/paths'

function getDirectorySize(dirPath: string): number {
    let size = 0
    if (!existsSync(dirPath)) return 0
    try {
        const files = readdirSync(dirPath)
        for (let i = 0; i < files.length; i++) {
            const filePath = path.join(dirPath, files[i])
            const stats = statSync(filePath)
            if (stats.isDirectory()) {
                size += getDirectorySize(filePath)
            } else {
                size += stats.size
            }
        }
    } catch { }
    return size
}

function getDiskUsage(dir: string) {
    const used = getDirectorySize(dir)
    const maxGB = parseInt(process.env.MAX_STORAGE_GB || '10', 10)
    const total = maxGB * 1024 * 1024 * 1024
    const free = Math.max(0, total - used)

    const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0
    const freePercent = total > 0 ? Math.round((free / total) * 100) : 0

    return { total, used, free, usedPercent, freePercent }
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
