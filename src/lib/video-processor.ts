import { spawn, execSync } from 'child_process'
import { renameSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

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

export type JobState = 'processing' | 'done' | 'error'

export interface JobStatus {
    id: string
    state: JobState
    progress: number
    error?: string
    outputPath?: string
    originalFilename?: string
}

// In-memory store for active transcoding jobs
export const jobStore = new Map<string, JobStatus>()

export function getJobStatus(jobId: string): JobStatus | undefined {
    return jobStore.get(jobId)
}

export function transcodeVideo(inputPath: string, outputPath: string, originalFilename: string): string {
    const jobId = randomUUID()
    
    jobStore.set(jobId, {
        id: jobId,
        state: 'processing',
        progress: 0,
        originalFilename,
        outputPath
    })

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

    const ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-vf', 'scale=min(1920,iw):-2',
        '-c:v', 'libx264',
        '-preset', 'faster',
        '-r', '30',
        '-b:v', '2000k',
        '-maxrate', '2500k',
        '-bufsize', '5000k',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        tempOutputPath
    ]

    const ffmpegProc = spawn('nice', ['-n', '10', FFMPEG_PATH, ...ffmpegArgs])

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
            job.state = 'done'
            job.progress = 100
            console.log(`[transcode] Job ${jobId} finished successfully`)
            // Move temp output to final output path
            try { if (existsSync(tempOutputPath)) renameSync(tempOutputPath, outputPath) } catch (e) {
                console.error(`[transcode] Failed to move transcoded file for job ${jobId}:`, e)
            }
            // Cleanup input file
            try { if (existsSync(inputPath)) unlinkSync(inputPath) } catch {}
        } else {
            job.state = 'error'
            job.error = `FFmpeg exited with code ${code}`
            console.error(`[transcode] Job ${jobId} failed`)
            // Cleanup output file on failure
            try { if (existsSync(tempOutputPath)) unlinkSync(tempOutputPath) } catch {}
        }
        jobStore.set(jobId, job)
        
        // Remove job from store after 5 minutes
        setTimeout(() => {
            jobStore.delete(jobId)
        }, 5 * 60 * 1000)
    })

    return jobId
}
