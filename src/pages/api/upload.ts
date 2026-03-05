import { NextApiRequest, NextApiResponse } from 'next'
import { createWriteStream, existsSync, unlinkSync, mkdirSync, statSync, readdirSync } from 'fs'
import path from 'path'
import Busboy from 'busboy'
import { VIDEOS_DIR } from '@/lib/paths'

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

export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
        externalResolver: true,
    },
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    // Disable socket timeout — large uploads can take many minutes
    if (req.socket) {
        req.socket.setTimeout(0)
        req.socket.setKeepAlive(true, 5000)
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const currentStorageUsed = getDirectorySize(VIDEOS_DIR)
    const maxGB = parseInt(process.env.MAX_STORAGE_GB || '10', 10)
    const maxStorageBytes = maxGB * 1024 * 1024 * 1024

    if (currentStorageUsed >= maxStorageBytes) {
        return res.status(403).json({ error: `Storage limit exceeded (${maxGB}GB). Please delete old videos.` })
    }

    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
        return res.status(400).json({ error: 'Expected multipart/form-data' })
    }

    let folder = ''
    let encodedName = ''
    let finalFilename = ''
    let originalName = ''
    let filepath = ''
    let bytesWritten = 0
    let uploadDir = VIDEOS_DIR
    let responded = false

    const sendError = (status: number, message: string) => {
        if (responded) return
        responded = true
        console.error(`[upload] Error ${status}: ${message}`)
        // delete incomplete file
        if (filepath && existsSync(filepath)) {
            try { unlinkSync(filepath) } catch { }
        }
        if (!res.headersSent) {
            res.status(status).json({ error: message })
        }
    }

    const sendSuccess = () => {
        if (responded) return
        responded = true
        if (!res.headersSent) {
            res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                file: {
                    filename: finalFilename,
                    originalName,
                    path: filepath,
                    size: bytesWritten,
                    folder: folder || 'root',
                },
            })
        }
    }

    try {
        const bb = Busboy({
            headers: req.headers,
            limits: {
                // No file size limit — never generate "file too large" error
                fileSize: Infinity,
                // Allow plenty of fields
                fields: 20,
            },
        })

        bb.on('field', (name, val) => {
            if (name === 'folder') folder = val
            if (name === 'encodedName') encodedName = val
        })

        bb.on('file', (fieldName, file, info) => {
            // Ignore unexpected field names
            if (fieldName !== 'file') {
                file.resume()
                return
            }

            originalName = info.filename || 'upload'
            if (encodedName) {
                try { originalName = decodeURIComponent(encodedName) } catch { }
            }

            const allowedExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.ts', '.webm', '.wmv']
            const ext = path.extname(originalName).toLowerCase()
            if (!allowedExtensions.includes(ext)) {
                file.resume()
                sendError(400, `Invalid file type (${ext}). Allowed: ${allowedExtensions.join(', ')}`)
                return
            }

            if (folder) {
                const candidateDir = path.join(VIDEOS_DIR, folder)
                if (!path.resolve(candidateDir).startsWith(path.resolve(VIDEOS_DIR))) {
                    file.resume()
                    sendError(400, 'Invalid folder path')
                    return
                }
                uploadDir = candidateDir
            }

            if (!existsSync(uploadDir)) {
                try {
                    mkdirSync(uploadDir, { recursive: true })
                } catch (err: any) {
                    file.resume()
                    sendError(500, `Cannot create directory: ${err.message}`)
                    return
                }
            }

            // Sanitize filename
            const extPart = path.extname(originalName).toLowerCase()
            let basePart = path.basename(originalName, extPart).replace(/[<>:"/\\|?*#\x00-\x1F]/g, '_').trim()
            if (basePart.length > 120) basePart = basePart.substring(0, 120).trim()
            let safeName = `${basePart}${extPart}`

            // Avoid collisions
            finalFilename = safeName
            filepath = path.join(uploadDir, finalFilename)
            let counter = 1
            while (existsSync(filepath)) {
                finalFilename = `${basePart} (${counter})${extPart}`
                filepath = path.join(uploadDir, finalFilename)
                counter++
            }

            const writeStream = createWriteStream(filepath)

            // Track bytes for progress/reporting
            file.on('data', (chunk) => {
                bytesWritten += chunk.length
                if (currentStorageUsed + bytesWritten > maxStorageBytes) {
                    file.pause()
                    writeStream.destroy()
                    sendError(413, `Upload aborted: storage limit exceeded (${maxGB}GB)`)
                }
            })

            // If busboy emits a size-limit truncation event, the file field
            // will emit 'limit'. We treat this as an error.
            file.on('limit', () => {
                sendError(413, 'File is too large')
            })

            file.on('error', (err) => {
                console.error('[upload] file stream error:', err.message)
                sendError(500, `File stream error: ${err.message}`)
            })

            writeStream.on('error', (err) => {
                console.error('[upload] write stream error:', err.message)
                sendError(500, `Write stream error: ${err.message}`)
            })

            // Only send success AFTER the write has fully flushed to disk
            writeStream.on('finish', () => {
                sendSuccess()
                // FIRE AND FORGET TRANSCODE
                import('@/lib/video-processor').then(m => m.processVideoAndEnforceLimits(filepath)).catch(console.error)
            })

            file.pipe(writeStream)
        })

        bb.on('error', (err) => {
            console.error('[upload] busboy error:', (err as Error).message)
            sendError(500, `Upload error: ${(err as Error).message}`)
        })

        // If request is aborted mid-upload
        req.on('aborted', () => {
            console.warn('[upload] request aborted by client')
            sendError(400, 'Upload cancelled by client')
        })

        req.on('error', (err) => {
            console.error('[upload] request error:', err.message)
            sendError(500, `Request error: ${err.message}`)
        })

        // Stream directly from request into busboy — ONE pipe, never again
        req.pipe(bb)

    } catch (err: any) {
        console.error('[upload] unexpected error:', err?.message || err)
        sendError(500, `Unexpected error: ${err?.message || err}`)
    }
}
