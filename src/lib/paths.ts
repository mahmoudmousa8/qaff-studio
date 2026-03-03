import path from 'path'

/**
 * Centralized path resolution for the Qaff Studio project.
 * All paths are configurable via ENV with sane defaults relative to project root.
 * No hardcoded user-specific paths (/home/z/...) anywhere.
 */

const PROJECT_ROOT = process.cwd()

function resolve(envVar: string, defaultRelative: string): string {
    const raw = process.env[envVar] || defaultRelative
    return path.resolve(PROJECT_ROOT, raw)
}

// ── Directory Paths ──────────────────────────────────────────────
export const APP_DATA_DIR = resolve('APP_DATA_DIR', './data')
export const VIDEOS_DIR = resolve('VIDEOS_DIR', './data/videos')
export const UPLOAD_DIR = resolve('UPLOAD_DIR', './data/upload')
export const DOWNLOAD_DIR = resolve('DOWNLOAD_DIR', './data/download')
export const LOGS_DIR = resolve('LOGS_DIR', './data/logs')

// ── Service Config ───────────────────────────────────────────────
export const STREAM_MANAGER_URL = process.env.STREAM_MANAGER_URL || 'http://127.0.0.1:3002'
export const STREAM_MANAGER_PORT = parseInt(process.env.STREAM_MANAGER_PORT || '3002', 10)
export const MAX_CONCURRENT_STREAMS = parseInt(process.env.MAX_CONCURRENT_STREAMS || '10', 10)
export const STAGGER_MS = parseInt(process.env.STAGGER_MS || '1000', 10)

// ── Utility ──────────────────────────────────────────────────────
export const ALL_DIRS = [APP_DATA_DIR, VIDEOS_DIR, UPLOAD_DIR, DOWNLOAD_DIR, LOGS_DIR]
