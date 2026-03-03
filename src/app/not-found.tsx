"use client"

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function NotFound() {
    return (
        <div className="h-screen flex flex-col items-center justify-center bg-background text-foreground">
            <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            <h2 className="text-3xl font-bold mb-2">404 - Not Found</h2>
            <p className="text-muted-foreground mb-6">Could not find requested resource</p>
            <Link href="/">
                <Button>Return Home</Button>
            </Link>
        </div>
    )
}
