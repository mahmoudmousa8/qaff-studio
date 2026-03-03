import { existsSync, mkdirSync, accessSync, constants, writeFileSync } from 'fs'
import { ALL_DIRS } from './paths'

/**
 * Bootstrap: create all required directories and validate read/write access.
 * Called once at startup (from db.ts and stream-manager boot).
 * Throws a clear error if any directory cannot be created or written to.
 */
export function ensureDirs(): void {
    for (const dir of ALL_DIRS) {
        try {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
                console.log(`[bootstrap] Created directory: ${dir}`)
            }

            // Validate read/write access
            accessSync(dir, constants.R_OK | constants.W_OK)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[bootstrap] FATAL: Cannot access directory ${dir}: ${msg}`)
            console.error(`[bootstrap] Please check permissions or set the correct path via ENV.`)
            throw new Error(`Directory access error: ${dir} – ${msg}`)
        }
    }
    console.log(`[bootstrap] All directories verified.`)

    // Auto-create default password file if missing
    const passwordFile = require('path').join(process.cwd(), 'data', 'password.txt')
    if (!existsSync(passwordFile)) {
        writeFileSync(passwordFile, 'qaff2024', 'utf-8')
        console.log(`[bootstrap] Created default password file: ${passwordFile}`)
    }
}

/**
 * Validate that critical environment variables are set.
 * Returns an array of error messages (empty = all good).
 */
export function validateEnv(): string[] {
    const errors: string[] = []

    if (!process.env.DATABASE_URL) {
        errors.push('DATABASE_URL is not set. Expected format: file:./data/app.db')
    }

    return errors
}
