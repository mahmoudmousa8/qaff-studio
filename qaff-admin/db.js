'use strict'
// ── db.js — SQLite database layer ─────────────────────────
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'admin.db'))

// Enable WAL for better concurrency
db.pragma('journal_mode = WAL')

// ── Schema ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id           INTEGER PRIMARY KEY DEFAULT 1,
    password_hash TEXT NOT NULL,
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    container_id  TEXT,
    container_name TEXT,
    port          INTEGER UNIQUE NOT NULL,
    slots         INTEGER NOT NULL DEFAULT 10,
    storage_gb    INTEGER NOT NULL DEFAULT 10,
    volume_name   TEXT,
    status        TEXT DEFAULT 'running',
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    client_id  INTEGER,
    details    TEXT,
    timestamp  TEXT DEFAULT (datetime('now'))
  );
`)

// Safe migrations
try { db.exec("ALTER TABLE clients ADD COLUMN whatsapp TEXT;") } catch (e) { }
try { db.exec("ALTER TABLE clients ADD COLUMN renewal_date TEXT;") } catch (e) { }

// ── Admin ─────────────────────────────────────────────────
const getAdmin = db.prepare('SELECT * FROM admin WHERE id = 1')
const upsertAdmin = db.prepare(`
  INSERT INTO admin (id, password_hash, updated_at)
  VALUES (1, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at
`)

// ── Clients ───────────────────────────────────────────────
const getAllClients = db.prepare('SELECT * FROM clients ORDER BY id ASC')
const getClientById = db.prepare('SELECT * FROM clients WHERE id = ?')
const getClientByPort = db.prepare('SELECT * FROM clients WHERE port = ?')

const createClient = db.prepare(`
  INSERT INTO clients (name, container_id, container_name, port, slots, storage_gb, volume_name, status, whatsapp, renewal_date)
  VALUES (@name, @container_id, @container_name, @port, @slots, @storage_gb, @volume_name, 'running', @whatsapp, @renewal_date)
`)

const updateClientStatus = db.prepare(`
  UPDATE clients SET status = ?, updated_at = datetime('now') WHERE id = ?
`)

const updateClientContainer = db.prepare(`
  UPDATE clients SET container_id = ?, updated_at = datetime('now') WHERE id = ?
`)

const updateClientSlots = db.prepare(`
  UPDATE clients SET slots = ?, updated_at = datetime('now') WHERE id = ?
`)

const updateClientInfo = db.prepare(`
  UPDATE clients SET whatsapp = ?, renewal_date = ?, updated_at = datetime('now') WHERE id = ?
`)

const deleteClient = db.prepare('DELETE FROM clients WHERE id = ?')

// ── Ports ─────────────────────────────────────────────────
const PORT_START = 31000
const getUsedPorts = db.prepare('SELECT port FROM clients')

function getNextAvailablePort() {
  const used = new Set(getUsedPorts.all().map(r => r.port))
  for (let p = PORT_START; p < PORT_START + 2000; p++) {
    if (!used.has(p)) return p
  }
  throw new Error('No available ports in range 31000–32999')
}

// ── Logs ──────────────────────────────────────────────────
const insertLog = db.prepare(`
  INSERT INTO logs (action, client_id, details) VALUES (?, ?, ?)
`)
const getLogs = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100')

function addLog(action, clientId, details) {
  insertLog.run(action, clientId || null, details || null)
}

module.exports = {
  getAdmin, upsertAdmin,
  getAllClients, getClientById, getClientByPort,
  createClient, updateClientStatus, updateClientContainer,
  updateClientSlots, updateClientInfo, deleteClient,
  getNextAvailablePort,
  addLog, getLogs,
}
