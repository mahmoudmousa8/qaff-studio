import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'

// Diagnostics page removed — redirect to home
export default function DiagnosticsPage() {
    redirect('/')
}
