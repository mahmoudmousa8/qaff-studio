import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const SALT_ROUNDS = 10
const SESSION_TTL = 12 * 60 * 60 * 1000 // 12 hours in ms

function getSecret(): string {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret === 'change-me-to-a-random-secure-string') {
        // In production, warn but still work (use a derived key)
        console.warn('[auth] SESSION_SECRET not set or using default — please set a random value in .env')
        return 'qaff-studio-fallback-key-' + (process.env.DATABASE_URL || 'default')
    }
    return secret
}

// ── Password hashing ──────────────────────────────────────────

export async function hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, SALT_ROUNDS)
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash)
}

// ── Session token (HMAC-signed, no JWT library needed) ────────

interface SessionPayload {
    exp: number // expiry timestamp
}

function sign(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(payload)
    return hmac.digest('hex')
}

export function createSessionToken(): string {
    const secret = getSecret()
    const payload: SessionPayload = {
        exp: Date.now() + SESSION_TTL
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = sign(payloadB64, secret)
    return `${payloadB64}.${signature}`
}

export function verifySessionToken(token: string): boolean {
    try {
        const secret = getSecret()
        const [payloadB64, signature] = token.split('.')
        if (!payloadB64 || !signature) return false

        // Verify signature
        const expectedSig = sign(payloadB64, secret)
        if (signature !== expectedSig) return false

        // Check expiry
        const payload: SessionPayload = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString()
        )
        if (Date.now() > payload.exp) return false

        return true
    } catch {
        return false
    }
}

// Cookie config
export const SESSION_COOKIE_NAME = 'qaff_session'
export const SESSION_MAX_AGE = 12 * 60 * 60 // 12 hours in seconds
