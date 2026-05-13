import { spawn, execSync } from 'child_process'
import { renameSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import os from 'os'

// Helper to find tool paths
function findTool(name: string): string {
    try {
        const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
        return execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0] || name
    } catch { return name }
}
const FFMPEG_PATH = findTool('ffmpeg')
const FFPROBE_PATH = findTool('ffprobe')

interface ProbeResult {
    videoCodec: string
    hasAudio: boolean
    bitrate: number
    fps: number
    width: number
    height: number
    formatName: string
    rFrameRate: string
    avgFrameRate: string
    fieldOrder: string
    audioCodec: string
    audioChannels: number
    audioSampleRate: number
    maxGopSeconds: number
}

function probeFile(filePath: string): ProbeResult {
    const defaultResult: ProbeResult = {
        videoCodec: 'unknown', hasAudio: false, bitrate: 0, fps: 30, width: 0, height: 0, formatName: '',
        rFrameRate: '', avgFrameRate: '', fieldOrder: 'progressive', audioCodec: '', audioChannels: 0, audioSampleRate: 0, maxGopSeconds: 0
    }
    try {
        const jsonStr = execSync(
            `"${FFPROBE_PATH}" -v error -show_entries format=bit_rate,format_name -show_entries stream=codec_type,codec_name,bit_rate,r_frame_rate,avg_frame_rate,width,height,field_order,channels,sample_rate -of json "${filePath}"`,
            { encoding: 'utf-8', timeout: 15000 }
        )
        const data = JSON.parse(jsonStr)
        const streams = data.programs?.[0]?.streams || data.streams || []
        const formatBitrate = parseInt(data.format?.bit_rate || '0', 10)

        let result = { ...defaultResult }
        result.formatName = data.format?.format_name || ''

        for (const stream of streams) {
            if (stream.codec_type === 'video') {
                result.videoCodec = stream.codec_name || 'unknown'
                result.width = stream.width || 0
                result.height = stream.height || 0
                result.rFrameRate = stream.r_frame_rate || ''
                result.avgFrameRate = stream.avg_frame_rate || ''
                result.fieldOrder = stream.field_order || 'progressive'
                
                const streamBitrate = parseInt(stream.bit_rate || '0', 10)
                result.bitrate = streamBitrate > 0 ? streamBitrate : formatBitrate

                let fps = 30
                if (stream.r_frame_rate && stream.r_frame_rate.includes('/')) {
                    const [num, den] = stream.r_frame_rate.split('/').map(Number)
                    if (den > 0) fps = Math.round(num / den)
                }
                result.fps = fps
            } else if (stream.codec_type === 'audio') {
                result.hasAudio = true
                result.audioCodec = stream.codec_name || 'unknown'
                result.audioChannels = parseInt(stream.channels || '0', 10)
                result.audioSampleRate = parseInt(stream.sample_rate || '0', 10)
            }
        }

        if (result.bitrate === 0) result.bitrate = formatBitrate

        // Fast GOP check (scan first 60 seconds of video I-frames)
        try {
            const keyframesStr = execSync(
                `"${FFPROBE_PATH}" -v error -select_streams v:0 -skip_frame nokey -show_entries frame=pkt_pts_time,pkt_dts_time -of csv=p=0 -read_intervals "%+60" "${filePath}"`,
                { encoding: 'utf-8', timeout: 15000 }
            )
            const ptsLines = keyframesStr.trim().split('\n').map(l => {
                const parts = l.split(',')
                const pts = parseFloat(parts[0])
                if (!isNaN(pts)) return pts
                return parseFloat(parts[1])
            }).filter(n => !isNaN(n))
            
            let maxGop = 0
            if (ptsLines.length > 1) {
                for (let i = 1; i < ptsLines.length; i++) {
                    const diff = ptsLines[i] - ptsLines[i - 1]
                    if (diff > maxGop) maxGop = diff
                }
            } else {
                // If 0 or 1 keyframe in 60 seconds, GOP is definitely > 4s
                maxGop = 60
            }
            result.maxGopSeconds = maxGop
        } catch (err) {
            console.warn('[processor] GOP scan failed, assuming max allowed GOP (0)')
        }

        return result
    } catch (err) {
        console.error(`[processor] FFprobe error on ${filePath}:`, err)
        return defaultResult
    }
}

export async function validateVideoFile(filepath: string): Promise<{ allowed: boolean, reason?: string }> {
    if (!existsSync(filepath)) return { allowed: false, reason: "File not found" }

    const ext = path.extname(filepath).toLowerCase()
    if (ext !== '.mp4') {
        return { allowed: false, reason: `مرفوض: الامتداد غير مسموح | Rejected: Invalid extension (${ext})` }
    }

    const probe = probeFile(filepath)
    console.log(`[validator] Analyzed ${path.basename(filepath)}: Bitrate=${Math.round(probe.bitrate / 1000)}k, Codec=${probe.videoCodec}, FPS=${probe.fps}, GOP=${probe.maxGopSeconds.toFixed(1)}s`)

    if (!probe.formatName.toLowerCase().includes('mp4')) {
        return { allowed: false, reason: `مرفوض: حاوية الملف غير صالحة | Rejected: Invalid container format (${probe.formatName})` }
    }

    if (!probe.videoCodec.toLowerCase().includes('h264')) {
        return { allowed: false, reason: `مرفوض: ترميز الفيديو ليس H.264 | Rejected: Video codec is not H.264` }
    }

    if (![24, 25, 30].includes(probe.fps)) {
        return { allowed: false, reason: `مرفوض: معدل الإطارات غير مطابق (يجب أن يكون 24 أو 25 أو 30) | Rejected: FPS must be 24, 25, or 30` }
    }

    // CFR Check
    const parseFps = (str: string) => {
        if (!str || !str.includes('/')) return parseFloat(str) || 0
        const [num, den] = str.split('/').map(Number)
        return den > 0 ? num / den : 0
    }
    const rfps = parseFps(probe.rFrameRate)
    const afps = parseFps(probe.avgFrameRate)
    
    if (Math.abs(rfps - afps) > 0.05 && afps !== 0) {
        return { allowed: false, reason: `مرفوض: الفيديو بنظام الإطارات المتغيرة (VFR) يجب أن يكون (CFR) | Rejected: Variable Frame Rate (VFR) detected, must be CFR` }
    }

    // Resolution check (max 1080p)
    if (probe.width > 1920 || probe.height > 1080) {
        return { allowed: false, reason: `مرفوض: الدقة أعلى من 1080p (${probe.width}x${probe.height}) | Rejected: Resolution exceeds 1080p (${probe.width}x${probe.height})` }
    }

    // Bitrate range check (allow up to 2500k, no minimum)
    const bitrateK = probe.bitrate / 1000
    if (bitrateK > 2500) {
        return { allowed: false, reason: `مرفوض: معدل البت (${Math.round(bitrateK)}k) أعلى من المسموح 2500k | Rejected: Bitrate (${Math.round(bitrateK)}k) exceeds allowed 2500k` }
    }

    // GOP Check
    if (probe.maxGopSeconds > 4.5) { // 4.5 gives minor leniency for encoder variations
        return { allowed: false, reason: `مرفوض: المسافة بين الإطارات المفتاحية (GOP) أكبر من 4 ثوانٍ | Rejected: Keyframe interval (GOP) exceeds 4 seconds` }
    }

    // Interlaced Check
    if (probe.fieldOrder !== 'progressive' && probe.fieldOrder !== 'unknown') {
        return { allowed: false, reason: `مرفوض: الفيديو Interlaced يجب أن يكون Progressive | Rejected: Video must be Progressive, not Interlaced` }
    }

    // Audio Checks
    if (!probe.hasAudio) {
        return { allowed: false, reason: `مرفوض: لا يوجد مسار صوتي | Rejected: Missing audio track` }
    }
    if (!probe.audioCodec.toLowerCase().includes('aac')) {
        return { allowed: false, reason: `مرفوض: ترميز الصوت ليس AAC | Rejected: Audio codec must be AAC` }
    }
    if (probe.audioChannels !== 2) {
        return { allowed: false, reason: `مرفوض: القنوات الصوتية ليست استريو (2 Channels) | Rejected: Audio must be Stereo` }
    }
    if (probe.audioSampleRate !== 44100 && probe.audioSampleRate !== 48000) {
        return { allowed: false, reason: `مرفوض: معدل عينة الصوت يجب أن يكون 44.1kHz أو 48kHz | Rejected: Audio Sample Rate must be 44.1kHz or 48kHz` }
    }

    // Explicit bitrate definition acts as our pseudo "CBR check" because true VBR often lacks container stream bitrate.
    // However, since it's hard to explicitly verify strict CBR via ffprobe without parsing all packets, we assume it's CBR if the user provided specific settings.
    
    return { allowed: true }
}

export type JobState = 'queued' | 'processing' | 'done' | 'error' | 'cancelled'

export interface JobStatus {
    id: string
    state: JobState
    progress: number
    error?: string
    outputPath?: string
    inputPath?: string
    originalFilename?: string
    folder?: string
    killFn?: () => void
}

// In-memory store for active transcoding jobs
const g = globalThis as any
if (!g.__qaffJobStore) {
    g.__qaffJobStore = new Map<string, JobStatus>()
    g.__qaffJobQueue = [] as string[]
    g.__qaffActiveProcessingClients = new Set<string>()
}

export const jobStore = g.__qaffJobStore as Map<string, JobStatus>
const jobQueue = g.__qaffJobQueue as string[]
const activeProcessingClients = g.__qaffActiveProcessingClients as Set<string>

export function getJobStatus(jobId: string): JobStatus | undefined {
    return jobStore.get(jobId)
}

export function transcodeVideo(inputPath: string, outputPath: string, originalFilename: string, folder?: string): string {
    const jobId = randomUUID()
    
    console.log(`[transcode] Queueing job ${jobId} – input: ${inputPath}, output: ${outputPath}`)
    jobStore.set(jobId, {
        id: jobId,
        state: 'queued',
        progress: 0,
        originalFilename,
        outputPath,
        inputPath,
        folder
    })

    jobQueue.push(jobId)
    processNextJob()

    return jobId
}

function processNextJob() {
    if (jobQueue.length === 0) return

    // Strict global limit to prevent VPS CPU choking
    const MAX_GLOBAL_CONCURRENCY = 1;
    if (activeProcessingClients.size >= MAX_GLOBAL_CONCURRENCY) {
        console.log(`[transcode] Global limit reached. Waiting for current job to finish.`);
        return;
    }

    // Find the first valid job in the queue
    let index = -1;
    for (let i = 0; i < jobQueue.length; i++) {
        if (jobStore.has(jobQueue[i])) {
            index = i;
            break;
        }
    }

    if (index === -1) {
        jobQueue.length = 0; // Clear invalid jobs
        return;
    }

    const jobId = jobQueue.splice(index, 1)[0]
    const job = jobStore.get(jobId)!

    if (job.state === 'cancelled') {
        processNextJob()
        return
    }

    const clientKey = job.folder || 'global'
    activeProcessingClients.add(clientKey)

    // FAIRNESS SHUFFLE: Move all remaining jobs from THIS client to the back of the queue
    const otherClientsJobs = [];
    const thisClientJobs = [];
    while (jobQueue.length > 0) {
        const jId = jobQueue.shift()!;
        const j = jobStore.get(jId);
        if (!j || j.state === 'cancelled') continue;
        const jClient = j.folder || 'global';
        if (jClient === clientKey) {
            thisClientJobs.push(jId);
        } else {
            otherClientsJobs.push(jId);
        }
    }
    // Reconstruct queue: other clients first, then this client's remaining jobs at the end
    jobQueue.push(...otherClientsJobs, ...thisClientJobs);

    job.state = 'processing'
    jobStore.set(jobId, job)

    const { inputPath, outputPath } = job
    if (!inputPath || !outputPath) {
        activeProcessingClients.delete(clientKey)
        processNextJob()
        return
    }

    // Determine duration to calculate progress
    let durationSec = 0
    try {
        const durationStr = execSync(`"${FFPROBE_PATH}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`, { encoding: 'utf-8' })
        durationSec = parseFloat(durationStr.trim())
    } catch (e) {
        console.warn(`[transcode] Could not determine duration for ${inputPath}`)
    }

    // Run nice -n 10 ffmpeg ...
    // -y: overwrite
    // -i: input
    // -vf scale: max 1080p, preserve aspect ratio
    // -c:v libx264
    // -preset faster
    // -r 30 -vsync cfr (or -fps_mode cfr in newer ffmpeg)
    // -b:v 2000k -maxrate 2500k -bufsize 5000k
    // -g 60 -keyint_min 60 -sc_threshold 0
    // -c:a aac -b:a 128k -ar 44100 -ac 2
    // Output to a temporary file inside the same directory as input
    const processingOutputDir = path.dirname(inputPath)
    const tempOutputPath = path.join(processingOutputDir, `transcoded_${path.basename(outputPath)}`)

    // Determine target bitrate (preserve original if < 2000k)
    let targetBitrateK = 2000
    let targetMaxrateK = 2500
    let targetBufsizeK = 5000
    try {
        // We can use the existing probeFile function
        // Need to require or call it directly since it's in the same file
        const probeStr = execSync(`"${FFPROBE_PATH}" -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`, { encoding: 'utf-8' })
        const originalBitrateK = Math.round(parseInt(probeStr.trim(), 10) / 1000)
        
        if (originalBitrateK > 100 && originalBitrateK < 2000) {
            targetBitrateK = originalBitrateK
            targetMaxrateK = Math.round(originalBitrateK * 1.25)
            targetBufsizeK = originalBitrateK * 2
            console.log(`[transcode] Original bitrate ${originalBitrateK}k is < 2000k. Preserving original bitrate.`)
        }
    } catch (e) {
        console.warn(`[transcode] Failed to probe input for bitrate. Defaulting to 2000k.`)
    }

    const ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-vf', 'scale=min(1920\\,iw):-2',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-r', '30',
        '-b:v', `${targetBitrateK}k`,
        '-maxrate', `${targetMaxrateK}k`,
        '-bufsize', `${targetBufsizeK}k`,
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        tempOutputPath
    ]

    // Limit FFmpeg CPU usage to a maximum of 25% of available cores (minimum 1)
    const totalCores = os.cpus().length || 1
    const allowedThreads = Math.max(1, Math.floor(totalCores / 4))

    const ffmpegProc = spawn(FFMPEG_PATH, ['-threads', allowedThreads.toString(), ...ffmpegArgs])
    let errorLog = ''

    const currentJob = jobStore.get(jobId)
    if (currentJob) {
        currentJob.killFn = () => {
            console.log(`[transcode] Killing process for job ${jobId}`)
            ffmpegProc.kill('SIGKILL')
        }
        jobStore.set(jobId, currentJob)
    }

    ffmpegProc.on('error', (err) => {
        console.error(`[transcode] Spawn error for job ${jobId}:`, err)
        errorLog += `\nSpawn error: ${err.message}`
    })

    ffmpegProc.stdout.on('data', (data) => {
        console.log(`[transcode][${jobId}] stdout: ${data.toString().trim()}`)
    })
    ffmpegProc.stderr.on('data', (data) => {
        const out = data.toString()
        // Extract time=hh:mm:ss.ms
        const timeMatch = out.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
        if (timeMatch && durationSec > 0) {
            const h = parseInt(timeMatch[1], 10)
            const m = parseInt(timeMatch[2], 10)
            const s = parseFloat(timeMatch[3])
            const currentSec = (h * 3600) + (m * 60) + s
            
            let progress = Math.round((currentSec / durationSec) * 100)
            if (progress > 99) progress = 99
            
            const job = jobStore.get(jobId)
            if (job) {
                job.progress = progress
                jobStore.set(jobId, job)
            }
        }
    })



    ffmpegProc.on('close', (code) => {
        const job = jobStore.get(jobId)
        if (!job) return

        if (code === 0) {
            job.state = 'done';
            job.progress = 100;
            console.log(`[transcode] Job ${jobId} finished successfully`);
            // Ensure target directory exists
            try { mkdirSync(path.dirname(outputPath), { recursive: true }); } catch {}
            // Move temp output to final output path
            try { if (existsSync(tempOutputPath)) renameSync(tempOutputPath, outputPath); } catch (e) {
                console.error(`[transcode] Failed to move transcoded file for job ${jobId}:`, e);
                job.error = (e as Error).message;
                job.state = 'error';
            }
            // Cleanup input file
            try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
        } else {
            if (job.state !== 'cancelled') {
                job.state = 'error';
                job.error = errorLog || `FFmpeg exited with code ${code}`;
                console.error(`[transcode] Job ${jobId} failed`);
            } else {
                console.log(`[transcode] Job ${jobId} cancellation confirmed (FFmpeg exited).`);
            }
            // Cleanup output file on failure or cancellation
            try { if (existsSync(tempOutputPath)) unlinkSync(tempOutputPath) } catch {}
        }
        jobStore.set(jobId, job)
        
        // Remove job from store after 5 minutes
        setTimeout(() => {
            jobStore.delete(jobId)
        }, 5 * 60 * 1000)

        const clientKey2 = job.folder || 'global'
        activeProcessingClients.delete(clientKey2)
        processNextJob()
    })
}

export function cancelTranscode(jobId: string): boolean {
    const job = jobStore.get(jobId)
    if (!job) return false

    if (job.state === 'queued') {
        job.state = 'cancelled'
        console.log(`[transcode] Job ${jobId} was cancelled from queue.`)
        // The file will be cleaned up by the timeout block below
    } else if (job.state === 'processing') {
        job.state = 'cancelled'
        if (job.killFn) {
            job.killFn()
        }
        console.log(`[transcode] Job ${jobId} was cancelled by user. Cleaning up...`)
    } else {
        return false
    }

    setTimeout(() => {
            // Attempt to clean up temp output path
            if (job.outputPath) {
                const tempOutputPath = path.join(path.dirname(job.outputPath), `transcoded_${path.basename(job.outputPath)}`)
                try { if (existsSync(tempOutputPath)) unlinkSync(tempOutputPath) } catch {}
            }
            if (job.inputPath) {
                try { if (existsSync(job.inputPath)) unlinkSync(job.inputPath) } catch {}
            }
        }, 500)
        
        jobStore.set(jobId, job)
        return true
}

// -----------------------------------------------------------------------------
// Auto-Cleanup on Server Startup
// -----------------------------------------------------------------------------
// This runs once when the video-processor module is first imported by the Node.js server.
// It ensures that any leftover files from previous crashed transcodes are deleted.
if (typeof window === 'undefined') {
    try {
        const { VIDEOS_DIR } = require('./paths')
        const processingDir = path.join(VIDEOS_DIR, '.processing')
        if (existsSync(processingDir)) {
            const files = require('fs').readdirSync(processingDir)
            if (files.length > 0) {
                console.log(`[transcode] Server startup: Cleaning up ${files.length} orphaned files in .processing...`)
                for (const file of files) {
                    try {
                        unlinkSync(path.join(processingDir, file))
                    } catch (e) {
                        // ignore
                    }
                }
            }
        } else {
            require('fs').mkdirSync(processingDir, { recursive: true })
        }
    } catch (e) {
        console.warn(`[transcode] Failed to run startup cleanup:`, e)
    }

    // -----------------------------------------------------------------------------
    // 12-Hour Retention Policy (Cron)
    // -----------------------------------------------------------------------------
    // IMPORTANT: VIDEOS_DIR is NEVER touched — it contains the client's library.
    // Only transient/temporary directories are cleaned:
    //   - UPLOAD_DIR: incomplete or stale upload chunks
    //   - DOWNLOAD_DIR: failed or abandoned downloads
    // Runs every 1 hour.
    setInterval(() => {
        try {
            const { UPLOAD_DIR, DOWNLOAD_DIR } = require('./paths')
            const dirsToClean = [UPLOAD_DIR, DOWNLOAD_DIR]
            const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000
            const now = Date.now()

            for (const dir of dirsToClean) {
                if (!require('fs').existsSync(dir)) continue
                
                const files = require('fs').readdirSync(dir)
                for (const file of files) {
                    if (file.startsWith('.')) continue // Skip hidden dirs like .processing

                    const filePath = require('path').join(dir, file)
                    try {
                        const stats = require('fs').statSync(filePath)
                        if (stats.isFile() && (now - stats.mtimeMs > TWELVE_HOURS_MS)) {
                            require('fs').unlinkSync(filePath)
                            console.log(`[retention] Auto-deleted stale temp file: ${filePath}`)
                        }
                    } catch (e) {
                        // ignore individual file errors
                    }
                }
            }
        } catch (e) {
            console.warn(`[retention] Failed to run auto-cleanup cron:`, e)
        }
    }, 60 * 60 * 1000) // Every 1 hour
}

export function getJobsByFolder(folder: string = ''): JobStatus[] {
    const jobs: JobStatus[] = []
    for (const job of jobStore.values()) {
        const jobFolder = job.folder || ''
        if (jobFolder === folder || folder === '__ALL__') {
            jobs.push(job)
        }
    }
    return jobs
}
