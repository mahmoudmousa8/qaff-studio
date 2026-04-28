import type { NextApiRequest, NextApiResponse } from 'next'
import { getJobStatus } from '@/lib/video-processor'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const { jobId } = req.query
    if (!jobId || typeof jobId !== 'string') {
        return res.status(400).json({ error: 'Missing jobId parameter' })
    }

    const status = getJobStatus(jobId)
    if (!status) {
        return res.status(404).json({ error: 'Job not found or expired' })
    }

    res.status(200).json({
        success: true,
        jobId: status.id,
        state: status.state,
        progress: status.progress,
        error: status.error,
        originalFilename: status.originalFilename
    })
}
