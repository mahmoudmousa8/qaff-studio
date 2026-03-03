import { NextRequest, NextResponse } from 'next/server'

// This endpoint is for polling a specific download job status
// The download jobs are tracked in the main download/route.ts

// Since Next.js API routes are serverless, we need to share state
// The download jobs map is in the parent route module
// We redirect to GET /api/download which returns all jobs, and filter client-side

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    // Fetch from the main download endpoint
    const baseUrl = request.nextUrl.origin
    try {
        const res = await fetch(`${baseUrl}/api/download`, { cache: 'no-store' })
        const data = await res.json()
        const job = data.downloads?.find((d: { id: string }) => d.id === id)

        if (!job) {
            return NextResponse.json({ error: 'Download not found', id }, { status: 404 })
        }

        return NextResponse.json(job)
    } catch {
        return NextResponse.json({ error: 'Failed to fetch download status' }, { status: 500 })
    }
}
