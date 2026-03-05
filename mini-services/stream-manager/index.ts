import { spawn, ChildProcess } from 'child_process'
import { createServer } from 'http'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import * as net from 'net'
import * as os from 'os'

// ── Configuration from ENV ───────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')

const PORT = parseInt(process.env.STREAM_MANAGER_PORT || '3002', 10)
const VIDEOS_DIR = resolve(PROJECT_ROOT, process.env.VIDEOS_DIR || './data/videos')
const LOGS_DIR = resolve(PROJECT_ROOT, process.env.LOGS_DIR || './data/logs')
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_STREAMS || '500', 10)
const STAGGER_DELAY_MS = parseInt(process.env.STAGGER_MS || '3000', 10)

// ── Boot: ensure dirs ────────────────────────────────────────
const ALL_DIRS = [
  resolve(PROJECT_ROOT, process.env.APP_DATA_DIR || './data'),
  VIDEOS_DIR,
  resolve(PROJECT_ROOT, process.env.UPLOAD_DIR || './data/upload'),
  resolve(PROJECT_ROOT, process.env.DOWNLOAD_DIR || './data/download'),
  LOGS_DIR,
]
for (const dir of ALL_DIRS) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    log(`Created directory: ${dir}`)
  }
}

// ── Startup time ─────────────────────────────────────────────
const STARTUP_TIME = Date.now()

// ── FFmpeg / FFprobe paths ───────────────────────────────────
function findTool(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    return execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0] || null
  } catch { return null }
}
const FFMPEG_PATH = findTool('ffmpeg') || 'ffmpeg'
const FFPROBE_PATH = findTool('ffprobe') || 'ffprobe'

// ── Stagger queue ────────────────────────────────────────────
let staggerQueue: Array<{
  slotIndex: number; rtmpUrl: string; streamKey: string; filePath: string
  resolve: (result: { success: boolean; message: string }) => void
}> = []
let isProcessingQueue = false

// ── Active streams ───────────────────────────────────────────
interface StreamInfo {
  process: ChildProcess
  slotIndex: number
  startTime: Date
  profile: string
  bitrateMbps: number    // current outgoing bitrate
  bitrateRaw: string     // e.g. "4500.0kbits/s"
}
const activeStreams: Map<number, StreamInfo> = new Map()

// ── Logging with streamKey masking ───────────────────────────
function log(message: string, streamKey?: string) {
  const timestamp = new Date().toISOString()
  let maskedMessage = message
  if (streamKey) {
    const masked = streamKey.length > 8
      ? streamKey.substring(0, 4) + '****' + streamKey.substring(streamKey.length - 4)
      : '****'
    maskedMessage = message.replace(streamKey, masked)
  }
  console.log(`[${timestamp}] ${maskedMessage}`)
}

// ── FFprobe: check source compatibility ──────────────────────
interface ProbeResult {
  videoCodec: string; audioCodec: string; fps: number; compatible: boolean
}

function probeFile(filePath: string): ProbeResult {
  const defaultResult: ProbeResult = { videoCodec: 'unknown', audioCodec: 'unknown', fps: 30, compatible: false }
  try {
    const vCodec = execSync(
      `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim().split('\n')[0] || 'unknown'

    const aCodec = execSync(
      `"${FFPROBE_PATH}" -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim().split('\n')[0] || 'unknown'

    let fps = 30
    try {
      const fpsRaw = execSync(
        `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "${filePath}"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim().split('\n')[0]
      if (fpsRaw && fpsRaw.includes('/')) {
        const [num, den] = fpsRaw.split('/').map(Number)
        if (den > 0) fps = Math.round(num / den)
      }
    } catch { }

    const compatible = vCodec.toLowerCase() === 'h264' && aCodec.toLowerCase() === 'aac'
    return { videoCodec: vCodec, audioCodec: aCodec, fps, compatible }
  } catch (err) {
    log(`FFprobe error: ${err instanceof Error ? err.message : err}`)
    return defaultResult
  }
}

// ── Build FFmpeg args ────────────────────────────────────────
function buildFfmpegArgs(filePath: string, rtmpUrl: string): { args: string[]; profile: string } {
  // Enforce zero-CPU direct copy architecture. All heavy lifting is now 
  // exclusively processed during upload/download processing to enforce the single-storage strategy.
  log(`  Profile: Direct Copy (Zero-CPU)`)
  return {
    profile: 'copy',
    args: [
      '-re',
      '-fflags', '+genpts+igndts',
      '-stream_loop', '-1',
      '-i', filePath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-vsync', '1',
      '-async', '1',
      '-max_muxing_queue_size', '1024',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ]
  }
}

// ── Build final RTMP URL from outputType + server + key ─────
function buildRtmpUrl(outputType: string, rtmpServer: string, streamKey: string): string {
  switch (outputType) {
    case 'youtube':
      return `rtmp://a.rtmp.youtube.com/live2/${streamKey}`
    case 'facebook':
      return `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`
    case 'tiktok':
    case 'custom':
    default:
      // rtmpServer is the full URL for TikTok/Custom
      return rtmpServer
  }
}

// ── Parse bitrate from FFmpeg progress stderr ────────────────
function parseBitrate(line: string): number | null {
  // FFmpeg outputs lines like: frame=  100 fps= 30 q=28.0 size=    2048kB time=00:00:03.33 bitrate=4908.1kbits/s speed=1.00x
  const match = line.match(/bitrate=\s*(\d+(?:\.\d+)?)\s*kbits\/s/)
  if (match) {
    return parseFloat(match[1]) / 1000 // convert kbits/s → Mbps
  }
  return null
}

// ── Process stagger queue ────────────────────────────────────
async function processStaggerQueue() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (staggerQueue.length > 0) {
    const item = staggerQueue.shift()!

    let waited = 0
    while (activeStreams.size >= MAX_CONCURRENT) {
      log(`Concurrency limit (${MAX_CONCURRENT}) reached. Waiting...`)
      await new Promise(r => setTimeout(r, STAGGER_DELAY_MS))
      waited += STAGGER_DELAY_MS
      if (waited > 60 * 60 * 1000) {
        item.resolve({ success: false, message: `Concurrency limit reached after waiting 1 hour` })
        break
      }
    }

    if (activeStreams.size >= MAX_CONCURRENT) continue

    const result = startStreamImmediate(item.slotIndex, item.rtmpUrl, item.streamKey, item.filePath)
    item.resolve(result)

    if (staggerQueue.length > 0) {
      log(`Stagger: waiting ${STAGGER_DELAY_MS}ms before next stream...`)
      await new Promise(r => setTimeout(r, STAGGER_DELAY_MS))
    }
  }

  isProcessingQueue = false
}

// ── Start a stream immediately ───────────────────────────────
function startStreamImmediate(slotIndex: number, rtmpUrl: string, streamKey: string, filePath: string): { success: boolean; message: string } {
  if (activeStreams.has(slotIndex)) {
    return { success: false, message: `Slot ${slotIndex + 1} is already streaming` }
  }

  if (activeStreams.size >= MAX_CONCURRENT) {
    return { success: false, message: `Concurrency limit (${MAX_CONCURRENT}) reached` }
  }

  if (!existsSync(filePath)) {
    return { success: false, message: `File not found: ${filePath}` }
  }

  // Mask the stream key in all log output
  const maskedUrl = streamKey
    ? rtmpUrl.replace(streamKey, streamKey.length > 8
      ? streamKey.substring(0, 4) + '****' + streamKey.substring(streamKey.length - 4)
      : '****')
    : rtmpUrl

  log(`Starting stream for slot ${slotIndex + 1}`)
  log(`  File: ${filePath}`)
  log(`  RTMP: ${maskedUrl}`)

  try {
    const { args, profile } = buildFfmpegArgs(filePath, rtmpUrl)

    const redactedArgs = args.map(a => a === rtmpUrl ? maskedUrl : a)
    log(`  FFmpeg cmd: ${FFMPEG_PATH} ${redactedArgs.join(' ')}`)

    const ffmpegProcess = spawn(FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const streamInfo: StreamInfo = {
      process: ffmpegProcess,
      slotIndex,
      startTime: new Date(),
      profile,
      bitrateMbps: 0,
      bitrateRaw: '0kbits/s'
    }
    activeStreams.set(slotIndex, streamInfo)

    let stderrBuffer = ''
    ffmpegProcess.stderr?.on('data', (data) => {
      const output = data.toString()
      stderrBuffer += output
      if (stderrBuffer.length > 4096) stderrBuffer = stderrBuffer.slice(-4096)

      // Parse bitrate from progress lines
      const lines = output.split('\n')
      for (const line of lines) {
        const mbps = parseBitrate(line)
        if (mbps !== null && activeStreams.has(slotIndex)) {
          const info = activeStreams.get(slotIndex)!
          info.bitrateMbps = mbps
          info.bitrateRaw = line.match(/bitrate=\s*(\d+(?:\.\d+)?kbits\/s)/)?.[1] || info.bitrateRaw
        }

        // Log errors (but never the raw RTMP URL with key)
        if (line.includes('error') || line.includes('Error') || line.includes('Invalid')) {
          const sanitized = streamKey ? line.replace(streamKey, '****') : line
          log(`[Slot ${slotIndex + 1} ERR]: ${sanitized.substring(0, 200).trim()}`)
        }
      }
    })

    ffmpegProcess.on('close', (code) => {
      log(`Slot ${slotIndex + 1} stream ended with code ${code}`)
      if (code !== 0 && stderrBuffer) {
        const lastLines = stderrBuffer.trim().split('\n').slice(-3).join(' | ')
        const sanitized = streamKey ? lastLines.replace(streamKey, '****') : lastLines
        log(`  Last stderr: ${sanitized.substring(0, 300)}`)
      }
      activeStreams.delete(slotIndex)
    })

    ffmpegProcess.on('error', (err) => {
      log(`Slot ${slotIndex + 1} error: ${err.message}`)
      activeStreams.delete(slotIndex)
    })

    const profileLabel = profile === 'copy' ? 'Direct Copy' : 'Transcode'
    return { success: true, message: `Slot ${slotIndex + 1}: Started streaming (${profileLabel})` }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log(`Failed to start stream for slot ${slotIndex + 1}: ${errorMessage}`)
    return { success: false, message: `Failed to start: ${errorMessage}` }
  }
}

// ── Queue a stream for staggered start ───────────────────────
function queueStream(slotIndex: number, rtmpUrl: string, streamKey: string, filePath: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    staggerQueue.push({ slotIndex, rtmpUrl, streamKey, filePath, resolve })
    log(`Slot ${slotIndex + 1} queued (queue position: ${staggerQueue.length})`)
    processStaggerQueue()
  })
}

// ── Stop a stream ────────────────────────────────────────────
function stopStream(slotIndex: number): { success: boolean; message: string } {
  const stream = activeStreams.get(slotIndex)

  if (!stream) {
    return { success: false, message: `Slot ${slotIndex + 1} is not streaming` }
  }

  try {
    stream.process.kill('SIGTERM')
    setTimeout(() => { try { stream.process.kill('SIGKILL') } catch { } }, 3000)
    activeStreams.delete(slotIndex)
    log(`Stopped stream for slot ${slotIndex + 1}`)
    return { success: true, message: `Slot ${slotIndex + 1}: Stopped` }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, message: `Failed to stop: ${errorMessage}` }
  }
}

// ── Get stream status ────────────────────────────────────────
function getStreamStatus(slotIndex: number): { isRunning: boolean; startTime?: string; duration?: number; profile?: string; bitrateMbps?: number } {
  const stream = activeStreams.get(slotIndex)
  if (!stream) return { isRunning: false }

  const duration = Math.floor((Date.now() - stream.startTime.getTime()) / 1000)
  return {
    isRunning: true,
    startTime: stream.startTime.toISOString(),
    duration,
    profile: stream.profile,
    bitrateMbps: stream.bitrateMbps
  }
}

function listActiveStreams(): number[] {
  return Array.from(activeStreams.keys())
}

// ── RAM stats ────────────────────────────────────────────────
function getRamStats(): { usedPercent: number; usedMB: number; totalMB: number } {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  return {
    usedPercent: Math.round((used / total) * 100),
    usedMB: Math.round(used / 1024 / 1024),
    totalMB: Math.round(total / 1024 / 1024)
  }
}

// ── PID lock: prevent double-start ───────────────────────────
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => { tester.close(); resolve(false) })
      .listen(port, '127.0.0.1')
  })
}

// ── HTTP Server ──────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const pathname = url.pathname

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return
  }

  try {
    // GET /health
    if (pathname === '/health' && req.method === 'GET') {
      const uptimeSeconds = Math.floor((Date.now() - STARTUP_TIME) / 1000)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        activeStreams: activeStreams.size,
        queueLength: staggerQueue.length,
        ffmpegPath: FFMPEG_PATH,
        ffprobePath: FFPROBE_PATH,
        uptimeSeconds,
        maxConcurrent: MAX_CONCURRENT,
        staggerMs: STAGGER_DELAY_MS,
        videosDir: VIDEOS_DIR
      }))
      return
    }

    // GET /stats/ram
    if (pathname === '/stats/ram' && req.method === 'GET') {
      const ram = getRamStats()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(ram))
      return
    }

    // GET /stats/bitrate?slotIndex=N
    if (pathname === '/stats/bitrate' && req.method === 'GET') {
      const slotIndex = parseInt(url.searchParams.get('slotIndex') || '-1')
      const stream = activeStreams.get(slotIndex)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        slotIndex,
        bitrateMbps: stream?.bitrateMbps ?? 0,
        bitrateRaw: stream?.bitrateRaw ?? '0kbits/s',
        isRunning: !!stream
      }))
      return
    }

    // POST /start - Staggered queue
    if (pathname === '/start' && req.method === 'POST') {
      const body = await readBody(req)
      const { slotIndex, outputType, rtmpServer, streamKey, filePath } = JSON.parse(body)

      // Build final RTMP URL from outputType
      const rtmpUrl = buildRtmpUrl(outputType || 'custom', rtmpServer || '', streamKey || '')

      const result = await queueStream(slotIndex, rtmpUrl, streamKey || '', filePath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    // POST /start-immediate
    if (pathname === '/start-immediate' && req.method === 'POST') {
      const body = await readBody(req)
      const { slotIndex, outputType, rtmpServer, streamKey, filePath } = JSON.parse(body)
      const rtmpUrl = buildRtmpUrl(outputType || 'custom', rtmpServer || '', streamKey || '')
      const result = startStreamImmediate(slotIndex, rtmpUrl, streamKey || '', filePath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    // POST /stop
    if (pathname === '/stop' && req.method === 'POST') {
      const body = await readBody(req)
      const { slotIndex } = JSON.parse(body)
      const result = stopStream(slotIndex)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    // POST /stop-all
    if (pathname === '/stop-all' && req.method === 'POST') {
      const stopped: number[] = []
      for (const [slotIndex] of activeStreams) {
        stopStream(slotIndex)
        stopped.push(slotIndex)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, stopped, count: stopped.length }))
      return
    }

    // GET /status
    if (pathname === '/status' && req.method === 'GET') {
      const slotIndex = parseInt(url.searchParams.get('slotIndex') || '-1')
      if (slotIndex >= 0) {
        const status = getStreamStatus(slotIndex)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(status))
      } else {
        const active = listActiveStreams()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ activeStreams: active, count: active.length, queueLength: staggerQueue.length }))
      }
      return
    }

    // Default
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      service: 'Qaff Stream Manager',
      version: '4.0.0',
      status: 'running',
      activeStreams: listActiveStreams().length,
      queueLength: staggerQueue.length,
      maxConcurrent: MAX_CONCURRENT,
      staggerDelay: STAGGER_DELAY_MS,
      endpoints: ['/health', '/start', '/start-immediate', '/stop', '/stop-all', '/status', '/stats/ram', '/stats/bitrate']
    }))

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: errorMessage }))
  }
})

// ── Read body ────────────────────────────────────────────────
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

// ── Start server with port-in-use guard ──────────────────────
async function startServer() {
  const inUse = await checkPortInUse(PORT)
  if (inUse) {
    log(`ERROR: Port ${PORT} is already in use!`)
    process.exit(1)
  }

  server.listen(PORT, '127.0.0.1', () => {
    log(`Qaff Stream Manager v4.0.0 started on 127.0.0.1:${PORT}`)
    log(`  Videos directory: ${VIDEOS_DIR}`)
    log(`  FFmpeg: ${FFMPEG_PATH}`)
    log(`  FFprobe: ${FFPROBE_PATH}`)
    log(`  Max concurrent: ${MAX_CONCURRENT}`)
    log(`  Stagger delay: ${STAGGER_DELAY_MS}ms`)
    log('Ready to accept connections')
  })
}

startServer()

// ── Graceful shutdown ────────────────────────────────────────
const shutdown = () => {
  log('Shutting down...')
  for (const [slotIndex, stream] of activeStreams) {
    log(`Stopping stream for slot ${slotIndex + 1}`)
    stream.process.kill('SIGTERM')
  }
  server.close(() => { log('Server closed'); process.exit(0) })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
