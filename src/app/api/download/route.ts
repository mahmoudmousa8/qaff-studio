import { NextRequest, NextResponse } from 'next/server'
import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync } from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { VIDEOS_DIR } from '@/lib/paths'

// In-memory download tracking
interface DownloadJob {
  id: string
  status: 'downloading' | 'complete' | 'error'
  filename: string
  folder: string
  filePath: string
  error?: string
  startedAt: number
  completedAt?: number
  bytesDownloaded: number
  totalBytes: number
  lastSpeedCheck: number
  lastSpeedBytes: number
  speedBps: number
}

// Global download jobs map
const downloadJobs = new Map<string, DownloadJob>()

// Clean old completed jobs after 10 minutes
function cleanOldJobs() {
  const now = Date.now()
  for (const [id, job] of downloadJobs) {
    if (job.status !== 'downloading' && job.completedAt && now - job.completedAt > 10 * 60 * 1000) {
      downloadJobs.delete(id)
    }
  }
}

// Follow redirects (up to 15 hops) with cookie support
function downloadFile(url: string, destPath: string, job: DownloadJob, maxRedirects = 15, cookies: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'))
    }

    const protocol = url.startsWith('https') ? https : http

    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(cookies.length > 0 ? { 'Cookie': cookies.join('; ') } : {}),
      },
    }, (res) => {
      // Collect cookies for redirect chain
      const setCookies = res.headers['set-cookie'] || []
      const newCookies = [...cookies, ...setCookies.map(c => c.split(';')[0])]

      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url)
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`
        }
        res.resume()
        return downloadFile(redirectUrl, destPath, job, maxRedirects - 1, newCookies).then(resolve).catch(reject)
      }

      if (res.statusCode && res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      // Check for Google Drive HTML warning page (virus scan bypass needed for large files)
      const contentType = res.headers['content-type'] || ''
      if (contentType.includes('text/html') && url.includes('google.com')) {
        let body = ''
        res.on('data', chunk => body += chunk.toString())
        res.on('end', () => {
          // Extract confirm token from the HTML page if present
          const confirmMatch = body.match(/confirm=([0-9A-Za-z_-]+)/)
          const fileId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1]
            || url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1]
          if (fileId) {
            const confirmToken = confirmMatch ? confirmMatch[1] : 't'
            const newUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}&authuser=0`
            downloadFile(newUrl, destPath, job, maxRedirects - 1, newCookies).then(resolve).catch(reject)
          } else {
            reject(new Error('Google Drive: Cannot extract file ID from URL'))
          }
        })
        return
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
      if (totalBytes > 0) {
        job.totalBytes = totalBytes
      } else {
        // Google Drive large files often omit content-length — mark as indeterminate
        job.totalBytes = -1
      }

      const fileStream = createWriteStream(destPath)

      res.on('data', (chunk: Buffer) => {
        job.bytesDownloaded += chunk.length
        // Speed calculation
        const now = Date.now()
        const elapsed = (now - job.lastSpeedCheck) / 1000
        if (elapsed >= 1) {
          job.speedBps = (job.bytesDownloaded - job.lastSpeedBytes) / elapsed
          job.lastSpeedBytes = job.bytesDownloaded
          job.lastSpeedCheck = now
        }
      })

      res.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close()
        resolve()
      })

      fileStream.on('error', (err) => {
        fileStream.close()
        try { unlinkSync(destPath) } catch { }
        reject(err)
      })
    })

    req.on('error', (err) => {
      reject(err)
    })

    // Timeout: 6 hours for very large files
    req.setTimeout(6 * 60 * 60 * 1000, () => {
      req.destroy()
      reject(new Error('Download timeout (6 hours)'))
    })
  })
}

// Sanitize filename: preserve Unicode/Arabic, only remove filesystem-unsafe chars
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

// Extract Google Drive file ID from various URL formats
function extractGDriveFileId(url: string): string | null {
  // Format: https://drive.google.com/file/d/FILE_ID/view
  let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (match) return match[1]

  // Format: https://drive.google.com/open?id=FILE_ID
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match) return match[1]

  // Format: https://drive.google.com/d/FILE_ID/...
  match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match) return match[1]

  // Format: https://drive.google.com/uc?export=download&id=FILE_ID  
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match) return match[1]

  return null
}

// POST - Start a download (returns immediately, runs in background)
export async function POST(request: NextRequest) {
  try {
    const { url, filename, folder } = await request.json()

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Ensure videos directory exists
    if (!existsSync(VIDEOS_DIR)) {
      mkdirSync(VIDEOS_DIR, { recursive: true })
    }

    // Determine target directory
    const targetDir = folder ? path.join(VIDEOS_DIR, folder) : VIDEOS_DIR

    // Security check - ensure we're still within VIDEOS_DIR
    const resolvedPath = path.resolve(targetDir)
    const resolvedBase = path.resolve(VIDEOS_DIR)
    if (!resolvedPath.startsWith(resolvedBase)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 })
    }

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    // Generate filename if not provided
    let targetFilename = filename
    if (!targetFilename) {
      // Extract from URL or generate
      try {
        const urlPath = new URL(url).pathname
        const urlFile = urlPath.split('/').pop() || 'video'
        targetFilename = urlFile.includes('.') ? urlFile : 'video.mp4'
      } catch {
        targetFilename = 'video.mp4'
      }
    }

    // Enforce strict mp4-only rule
    const MP4_ONLY = ['.mp4']
    const ext = path.extname(targetFilename).toLowerCase()
    if (!MP4_ONLY.includes(ext)) {
      targetFilename = path.basename(targetFilename, path.extname(targetFilename)) + '.mp4'
    }

    // Sanitize filename — preserve Unicode/Arabic
    const extFinal = path.extname(targetFilename)
    const baseName = path.basename(targetFilename, extFinal)
    targetFilename = sanitizeFilename(baseName) + extFinal

    let targetPath = path.join(targetDir, targetFilename)

    // Auto-increment if file exists (e.g. video (1).mp4)
    if (existsSync(targetPath)) {
      let counter = 1
      while (existsSync(targetPath)) {
        targetFilename = `${sanitizeFilename(baseName)} (${counter})${extFinal}`
        targetPath = path.join(targetDir, targetFilename)
        counter++
      }
    }

    // Convert Google Drive share link to direct download link (new endpoint)
    let downloadUrl = url
    if (url.includes('drive.google.com')) {
      const fileId = extractGDriveFileId(url)
      if (fileId) {
        // Use the newer usercontent endpoint which works for large files
        downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
      }
    }

    // Create download job
    cleanOldJobs()
    const jobId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const job: DownloadJob = {
      id: jobId,
      status: 'downloading',
      filename: targetFilename,
      folder: folder || 'root',
      filePath: targetPath,
      startedAt: Date.now(),
      bytesDownloaded: 0,
      totalBytes: 0,
      lastSpeedCheck: Date.now(),
      lastSpeedBytes: 0,
      speedBps: 0,
    }
    downloadJobs.set(jobId, job)

    // Start download in background (don't await!)
    downloadFile(downloadUrl, targetPath, job)
      .then(async () => {
        // Validate video before keeping
        try {
          const processor = await import('@/lib/video-processor')
          const check = await processor.validateVideoFile(targetPath)
          if (!check.allowed) {
            job.status = 'error'
            job.error = check.reason || 'المقطع غير متوافق مع معايير المنصة'
            job.completedAt = Date.now()
            try { unlinkSync(targetPath) } catch { }
            console.error(`[download] Rejected: ${targetFilename} — ${job.error}`)
            return
          }
        } catch (e) {
          console.error('[download] validation error:', e)
        }

        job.status = 'complete'
        job.completedAt = Date.now()
        // Get final file size
        try {
          const stat = statSync(targetPath)
          job.bytesDownloaded = stat.size
        } catch { }
        console.log(`[download] Complete: ${targetFilename} (${(job.bytesDownloaded / 1024 / 1024).toFixed(1)} MB)`)
      })
      .catch((err) => {
        job.status = 'error'
        job.error = err.message || 'Unknown error'
        job.completedAt = Date.now()
        console.error(`[download] Failed: ${targetFilename} — ${err.message}`)
        // Clean up partial file
        try { unlinkSync(targetPath) } catch { }
      })

    // Return immediately with job ID
    return NextResponse.json({
      success: true,
      message: 'Download started',
      downloadId: jobId,
      filename: targetFilename,
      folder: folder || 'root',
    }, { status: 202 })

  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Download failed: ' + (error as Error).message }, { status: 500 })
  }
}

// GET - List active/recent download jobs
export async function GET() {
  cleanOldJobs()
  const jobs = Array.from(downloadJobs.values()).map(job => {
    // totalBytes = -1 means Google Drive gave no content-length (indeterminate)
    const isIndeterminate = job.totalBytes <= 0
    const percent = (!isIndeterminate) ? Math.round((job.bytesDownloaded / job.totalBytes) * 100) : null
    const etaSec = (job.speedBps > 0 && !isIndeterminate)
      ? Math.round((job.totalBytes - job.bytesDownloaded) / job.speedBps)
      : null
    return {
      id: job.id,
      status: job.status,
      filename: job.filename,
      folder: job.folder,
      error: job.error,
      bytesDownloaded: job.bytesDownloaded,
      totalBytes: job.totalBytes,
      indeterminate: isIndeterminate,
      bytesFormatted: (job.bytesDownloaded / 1024 / 1024).toFixed(1) + ' MB',
      totalFormatted: (!isIndeterminate) ? (job.totalBytes / 1024 / 1024).toFixed(1) + ' MB' : null,
      percent,
      speedBps: job.speedBps,
      speedFormatted: job.speedBps > 0 ? (job.speedBps / 1024 / 1024).toFixed(1) + ' MB/s' : null,
      etaSec,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      elapsed: job.completedAt ? job.completedAt - job.startedAt : Date.now() - job.startedAt,
    }
  })
  return NextResponse.json({ downloads: jobs })
}
