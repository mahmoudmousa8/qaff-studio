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
}

function probeFile(filePath: string): ProbeResult {
    const defaultResult: ProbeResult = { videoCodec: 'unknown', hasAudio: false, bitrate: 0, fps: 30, width: 0, height: 0, formatName: '' }
    try {
        const jsonStr = execSync(
            `"${FFPROBE_PATH}" -v error -show_entries format=bit_rate,format_name -show_entries stream=codec_type,codec_name,bit_rate,r_frame_rate,width,height -of json "${filePath}"`,
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
            }
        }

        if (result.bitrate === 0) result.bitrate = formatBitrate
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
    console.log(`[validator] Analyzed ${path.basename(filepath)}: Bitrate=${Math.round(probe.bitrate / 1000)}k, Codec=${probe.videoCodec}, Format=${probe.formatName}`)

    if (!probe.formatName.toLowerCase().includes('mp4')) {
        return { allowed: false, reason: `مرفوض: حاوية الملف غير صالحة | Rejected: Invalid container format (${probe.formatName})` }
    }

    if (probe.videoCodec !== 'h264') {
        return { allowed: false, reason: `مرفوض: الفيديو ترميزه ليس H.264 | Rejected: Video codec is not H.264` }
    }

    if (!probe.hasAudio) {
        return { allowed: false, reason: `مرفوض: لا يوجد مسار صوتي | Rejected: Missing audio track` }
    }

    return { allowed: true }
}
