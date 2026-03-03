import { ensureDirs, validateEnv } from './ensure-dirs'

// ── Bootstrap: ensure directories exist (skip during build) ──
const isBuildPhase = process.argv.some(a => a.includes('next') && process.argv.includes('build'))
if (!isBuildPhase) {
  try {
    ensureDirs()
  } catch (err) {
    console.error('[db] Failed to bootstrap directories:', err)
  }

  const envErrors = validateEnv()
  if (envErrors.length > 0) {
    console.error('[db] ⚠️  Environment validation errors:')
    envErrors.forEach(e => console.error(`  - ${e}`))
    console.error('[db] Copy .env.example to .env and fill in the values.')
  }
}

// ── Prisma singleton ─────────────────────────────────────────
let PrismaClientConstructor: any
try {
  PrismaClientConstructor = require('@prisma/client').PrismaClient
} catch {
  console.error('[db] @prisma/client not found. Run: npx prisma generate')
}

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined
}

export const db: any =
  globalForPrisma.prisma ??
  (PrismaClientConstructor
    ? new PrismaClientConstructor({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
    })
    : null)

if (process.env.NODE_ENV !== 'production' && db) globalForPrisma.prisma = db