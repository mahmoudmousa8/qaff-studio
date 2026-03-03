'use strict'
// ── auth.js — JWT + bcrypt authentication ─────────────────
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('./db')

const JWT_SECRET = process.env.JWT_SECRET || 'qaff-admin-super-secret-jwt-key-2024'
const JWT_EXPIRY = '24h'
const BCRYPT_ROUNDS = 12

/**
 * Hash a plain-text password
 */
async function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

/**
 * Verify plain password against stored hash
 */
async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash)
}

/**
 * Generate JWT token
 */
function generateToken() {
    return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY })
}

/**
 * Validate JWT token — returns payload or null
 */
function validateToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET)
    } catch {
        return null
    }
}

/**
 * Express middleware: require valid JWT in Authorization header or cookie
 */
function requireAuth(req, res, next) {
    let token = null

    // Check Authorization header
    const authHeader = req.headers['authorization']
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7)
    }

    // Fallback to cookie
    if (!token && req.cookies && req.cookies['qaff_admin_token']) {
        token = req.cookies['qaff_admin_token']
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    const payload = validateToken(token)
    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.admin = payload
    next()
}

/**
 * Initialize admin record with default password if not set
 */
async function initAdminPassword(defaultPassword = 'Admin123@') {
    const existing = db.getAdmin.get()
    if (!existing) {
        const hash = await hashPassword(defaultPassword)
        db.upsertAdmin.run(hash)
        console.log(`  ✅ Admin password initialized (default: ${defaultPassword})`)
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken,
    validateToken,
    requireAuth,
    initAdminPassword,
}
