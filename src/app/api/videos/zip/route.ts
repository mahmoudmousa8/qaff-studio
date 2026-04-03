import { NextRequest, NextResponse } from 'next/server'
import { VIDEOS_DIR } from '@/lib/paths'
import archiver from 'archiver'
import { resolve, relative, basename } from 'path'
import { statSync, existsSync, createReadStream } from 'fs'

// GET /api/videos/zip?paths=folder/file1,folder/file2
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url)
        const pathsParam = url.searchParams.get('paths')
        let zipName = url.searchParams.get('name') || 'download.zip'

        if (!pathsParam) {
            return NextResponse.json({ error: 'paths required' }, { status: 400 })
        }

        if (!zipName.endsWith('.zip')) zipName += '.zip'

        const paths = pathsParam.split(',').map(p => p.trim()).filter(Boolean)
        
        // Security check
        const resolvedPaths = paths.map(p => {
            const safePath = p.replace(/\.\.\//g, '').replace(/\.\.\\/g, '')
            const fullPath = resolve(VIDEOS_DIR, safePath)
            return { fullPath, safePath, exists: existsSync(fullPath) }
        }).filter(item => item.exists && item.fullPath.startsWith(resolve(VIDEOS_DIR)))

        if (resolvedPaths.length === 0) {
            return NextResponse.json({ error: 'No valid files found' }, { status: 404 })
        }

        const archive = archiver('zip', {
            zlib: { level: 0 }, // level 0 for faster stream (store only) because mp4 is already compressed
        })

        archive.on('error', (err) => {
            console.error('[zip] Archiver error:', err)
        })

        const webStream = new ReadableStream({
            start(controller) {
                archive.on('data', (chunk) => controller.enqueue(chunk))
                archive.on('end', () => controller.close())
                archive.on('error', (err) => controller.error(err))

                // Append files
                for (const item of resolvedPaths) {
                    const stat = statSync(item.fullPath)
                    if (stat.isDirectory()) {
                        archive.directory(item.fullPath, basename(item.fullPath))
                    } else {
                        archive.file(item.fullPath, { name: basename(item.fullPath) })
                    }
                }
                archive.finalize()
            },
        })

        return new NextResponse(webStream, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
                // We cannot send Content-Length because it's streamed on the fly
                'Cache-Control': 'no-cache',
            },
        })

    } catch (error) {
        console.error('[zip] Error:', error)
        return NextResponse.json({ error: 'Stream error' }, { status: 500 })
    }
}
