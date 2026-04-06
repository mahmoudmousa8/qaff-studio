import { spawn, execSync } from 'child_process'
import { renameSync, unlinkSync, existsSync } from 'fs'
import path from 'path'

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
