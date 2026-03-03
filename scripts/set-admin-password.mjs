#!/usr/bin/env node

/**
 * Set Admin Password for Qaff Studio
 * 
 * Usage:
 *   node scripts/set-admin-password.mjs NEW_PASSWORD
 * 
 * This script hashes the password with bcrypt and stores it in the database.
 * The password is NEVER logged or printed.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

async function main() {
    const newPassword = process.argv[2]

    if (!newPassword) {
        console.error('❌ Usage: node scripts/set-admin-password.mjs NEW_PASSWORD')
        console.error('   Example: node scripts/set-admin-password.mjs MySecurePass123')
        process.exit(1)
    }

    if (newPassword.length < 3) {
        console.error('❌ Password must be at least 3 characters long')
        process.exit(1)
    }

    const prisma = new PrismaClient()

    try {
        // Hash the password
        const hash = await bcrypt.hash(newPassword, SALT_ROUNDS)

        // Upsert admin user (create if not exists, update if exists)
        await prisma.adminUser.upsert({
            where: { id: 1 },
            update: { passwordHash: hash },
            create: { id: 1, passwordHash: hash },
        })

        console.log('✅ Admin password updated successfully')
    } catch (error) {
        console.error('❌ Failed to update password:', error.message)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

main()
