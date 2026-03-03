import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, statSync } from 'fs'
import { resolve } from 'path'
import { VIDEOS_DIR } from '@/lib/paths'

// GET /api/videos/stream?path=relative/video.mp4
// Streams a video file for in-browser preview with Range support
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url)
        const relativePath = url.searchParams.get('path')

        if (!relativePath) {
            return NextResponse.json({ error: 'path required' }, { status: 400 })
        }

        // Security: prevent path traversal
        const safePath = relativePath.replace(/\.\.\//g, '').replace(/\.\.\\/g, '')
        const fullPath = resolve(VIDEOS_DIR, safePath)

        // Ensure the resolved path is inside VIDEOS_DIR
        if (!fullPath.startsWith(resolve(VIDEOS_DIR))) {
            return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }

        let stat: ReturnType<typeof statSync>
        try {
            stat = statSync(fullPath)
        } catch {
            return NextResponse.json({ error: 'File not found' }, { status: 404 })
        }

        const fileSize = stat.size
        const rangeHeader = request.headers.get('range')

        if (rangeHeader) {
            // Support HTTP Range requests (required for video seeking)
            const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-')
            const start = parseInt(startStr, 10)
            const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1)
            const chunkSize = end - start + 1

            const stream = createReadStream(fullPath, { start, end })
            const webStream = new ReadableStream({
                start(controller) {
                    stream.on('data', (chunk) => controller.enqueue(chunk))
                    stream.on('end', () => controller.close())
                    stream.on('error', (err) => controller.error(err))
                },
            })

            return new NextResponse(webStream, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(chunkSize),
                    'Content-Type': 'video/mp4',
                    'Cache-Control': 'no-cache',
                },
            })
        } else {
            // Full file response
            const stream = createReadStream(fullPath)
            const webStream = new ReadableStream({
                start(controller) {
                    stream.on('data', (chunk) => controller.enqueue(chunk))
                    stream.on('end', () => controller.close())
                    stream.on('error', (err) => controller.error(err))
                },
            })

            return new NextResponse(webStream, {
                status: 200,
                headers: {
                    'Content-Length': String(fileSize),
                    'Content-Type': 'video/mp4',
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'no-cache',
                },
            })
        }
    } catch (error) {
        console.error('[stream] Error:', error)
        return NextResponse.json({ error: 'Stream error' }, { status: 500 })
    }
}
