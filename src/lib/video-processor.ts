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
    audioCodec: string
    bitrate: number
    fps: number
    pixFmt: string
}

function probeFile(filePath: string): ProbeResult {
    const defaultResult: ProbeResult = { videoCodec: 'unknown', audioCodec: 'unknown', bitrate: 0, fps: 30, pixFmt: 'unknown' }
    try {
        const jsonStr = execSync(
            `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=codec_name,bit_rate,r_frame_rate,pix_fmt -of json "${filePath}"`,
            { encoding: 'utf-8', timeout: 15000 }
        )
        const data = JSON.parse(jsonStr)
        const stream = data.programs?.[0]?.streams?.[0] || data.streams?.[0]

        if (!stream) return defaultResult

        let fps = 30
        if (stream.r_frame_rate && stream.r_frame_rate.includes('/')) {
            const [num, den] = stream.r_frame_rate.split('/').map(Number)
            if (den > 0) fps = Math.round(num / den)
        }

        return {
            videoCodec: stream.codec_name || 'unknown',
            audioCodec: 'aac', // Assume we check later or just force audio transcode if needed, but video is the main concern for CPU
            bitrate: parseInt(stream.bit_rate || '0', 10),
            fps,
            pixFmt: stream.pix_fmt || 'unknown'
        }
    } catch (err) {
        console.error(`[processor] FFprobe error on ${filePath}:`, err)
        return defaultResult
    }
}

export async function validateVideoFile(filepath: string): Promise<{ allowed: boolean, reason?: string }> {
    if (!existsSync(filepath)) return { allowed: false, reason: "File not found" }

    const probe = probeFile(filepath)
    console.log(`[validator] Analyzed ${path.basename(filepath)}: Bitrate=${Math.round(probe.bitrate / 1000)}k, Codec=${probe.videoCodec}`)

    if (probe.videoCodec !== 'h264') {
        return { allowed: false, reason: `نوع الترميز غير مدعوم (${probe.videoCodec}). المنصة تقبل ترميز H.264 فقط.` }
    }

    if (probe.bitrate > 2600000) {
        return { allowed: false, reason: `جودة الفيديو (Bitrate) عالية جداً (${Math.round(probe.bitrate / 1000)}k). الحد الأقصى المسموح به هو 2500k.` }
    }

    return { allowed: true }
}
