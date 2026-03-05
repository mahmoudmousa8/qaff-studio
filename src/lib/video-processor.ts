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

/**
 * Runs asynchronously in the background.
 * Validates the file and transcodes it if it exceeds 2500 kbps or has unsupported formats.
 */
export async function processVideoAndEnforceLimits(finalFilepath: string) {
    if (!existsSync(finalFilepath)) return

    const processingPath = finalFilepath + '.processing'
    const tmpPath = finalFilepath + '.tmp.mp4'

    try {
        // Hide file from UI while processing
        renameSync(finalFilepath, processingPath)

        const probe = probeFile(processingPath)
        console.log(`[processor] Analyzed ${path.basename(finalFilepath)}: Bitrate=${Math.round(probe.bitrate / 1000)}k, Codec=${probe.videoCodec}, FPS=${probe.fps}, PixFmt=${probe.pixFmt}`)

        // 1. Strict H.264 Enforcement: reject and delete non-H.264 files
        if (probe.videoCodec !== 'h264') {
            console.error(`[processor] Rejected ${path.basename(finalFilepath)}. Codec is ${probe.videoCodec}, but only H.264 is allowed. Deleting file.`)
            unlinkSync(processingPath)
            return
        }

        // 2. Transcode ONLY if bitrate > 2500k (using 2600000 as margin). Ignoring fps, gop, pix_fmt.
        if (probe.bitrate > 0 && probe.bitrate <= 2600000) {
            console.log(`[processor] Video bitrate is ${Math.round(probe.bitrate / 1000)}k (<= 2500k). No transcode needed.`)
            renameSync(processingPath, finalFilepath)
            return
        }

        console.log(`[processor] Video bitrate ${Math.round(probe.bitrate / 1000)}k exceeds 2500k. Starting ffmpeg transcode...`)

        const args = [
            '-i', processingPath,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-profile:v', 'high',
            '-level', '4.1',
            '-pix_fmt', 'yuv420p',
            '-r', '25',
            '-g', '50',
            '-b:v', '2500k',
            '-maxrate', '2500k',
            '-bufsize', '5000k',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2',
            '-movflags', '+faststart',
            '-y', // overwrite tmp if exists
            tmpPath
        ]

        await new Promise<void>((resolve, reject) => {
            const ffmpegProcess = spawn(FFMPEG_PATH, args, { stdio: 'ignore' })
            ffmpegProcess.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`FFmpeg exited with code ${code}`))
            })
            ffmpegProcess.on('error', reject)
        })

        // On success, replace original target with the transcoded file
        if (existsSync(tmpPath)) {
            renameSync(tmpPath, finalFilepath)
            unlinkSync(processingPath)
            console.log(`[processor] Transcode complete for ${path.basename(finalFilepath)}. File replaced.`)
        } else {
            throw new Error("Transcode finished but temporary file not found.")
        }

    } catch (err) {
        console.error(`[processor] Error processing video ${finalFilepath}:`, err)
        // Recovery: if something failed, try to restore the original file so it's not permanently lost
        if (existsSync(processingPath) && !existsSync(finalFilepath)) {
            try { renameSync(processingPath, finalFilepath) } catch { }
        }
        if (existsSync(tmpPath)) {
            try { unlinkSync(tmpPath) } catch { }
        }
    }
}
