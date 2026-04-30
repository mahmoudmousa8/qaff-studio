import type { NextApiRequest, NextApiResponse } from 'next'
import { getJobsByFolder } from '@/lib/video-processor'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const { folder } = req.query
    const folderStr = typeof folder === 'string' ? folder : ''

    const jobs = getJobsByFolder('__ALL__')

    res.status(200).json({
        success: true,
        jobs: jobs.map(job => ({
            id: job.id,
            state: job.state,
            progress: job.progress,
            originalFilename: job.originalFilename,
            error: job.error
        }))
    })
}
