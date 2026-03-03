import { NextResponse } from 'next/server'
import { readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import { VIDEOS_DIR } from '@/lib/paths'

// GET - List available videos
export async function GET() {
  try {
    if (!existsSync(VIDEOS_DIR)) {
      return NextResponse.json({ videos: [], count: 0 })
    }

    const files = readdirSync(VIDEOS_DIR)
    const allowedExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv']

    const videos = files
      .filter(f => allowedExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const filePath = path.join(VIDEOS_DIR, f)
        const stats = statSync(filePath)

        // Format file size
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)

        return {
          name: f,
          path: filePath,
          size: stats.size,
          sizeFormatted: sizeMB + ' MB',
          modified: stats.mtime.toISOString()
        }
      })
      .sort((a, b) => b.modified.localeCompare(a.modified))

    return NextResponse.json({ videos, count: videos.length })
  } catch (error) {
    console.error('Error listing videos:', error)
    return NextResponse.json({ error: 'Failed to list videos' }, { status: 500 })
  }
}
