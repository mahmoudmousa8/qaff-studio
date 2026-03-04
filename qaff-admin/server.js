'use strict'
// ── server.js — Qaff Admin Master Panel ───────────────────
const express = require('express')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const db = require('./db')
const auth = require('./auth')
const docker = require('./docker')

const app = express()
const PORT = process.env.ADMIN_PORT || 4000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

// Simple cookie parser (no extra dep)
app.use((req, _res, next) => {
    req.cookies = {}
    const raw = req.headers.cookie
    if (raw) raw.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=')
        req.cookies[k.trim()] = v.join('=').trim()
    })
    next()
})

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

// ── Serve HTML pages ──────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')))
app.get('/clients', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'clients.html')))

// ── Auth API ──────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    const { password } = req.body
    if (!password) return res.status(400).json({ error: 'Password required' })

    const admin = db.getAdmin.get()
    if (!admin) return res.status(500).json({ error: 'Admin not initialized' })

    const valid = await auth.verifyPassword(password, admin.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid password' })

    const token = auth.generateToken()
    db.addLog('admin_login', null, 'Admin logged in')
    res.json({ token })
})

// ── Admin: change own password ────────────────────────────
app.put('/api/admin/password', auth.requireAuth, async (req, res) => {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }
    const hash = await auth.hashPassword(newPassword)
    db.upsertAdmin.run(hash)
    db.addLog('admin_password_changed', null, 'Admin password changed')
    res.json({ success: true })
})

// ── Dashboard stats ───────────────────────────────────────
app.get('/api/dashboard', auth.requireAuth, async (req, res) => {
    const clients = db.getAllClients.all()
    const totalSlots = clients.reduce((s, c) => s + c.slots, 0)
    const totalStorage = clients.reduce((s, c) => s + c.storage_gb, 0)

    // Disk info from OS
    let diskTotal = 0, diskUsed = 0, diskFree = 0
    try {
        const out = execSync("df -BG / | tail -1").toString().trim().split(/\s+/)
        diskTotal = parseInt(out[1])
        diskUsed = parseInt(out[2])
        diskFree = parseInt(out[3])
    } catch { }

    const logs = db.getLogs.all()

    res.json({
        clients: {
            total: clients.length,
            running: clients.filter(c => c.status === 'running').length,
            stopped: clients.filter(c => c.status === 'stopped').length,
            suspended: clients.filter(c => c.status === 'suspended').length,
        },
        slots: { total: totalSlots },
        storage: { allocated_gb: totalStorage, disk_total_gb: diskTotal, disk_used_gb: diskUsed, disk_free_gb: diskFree },
        logs: logs.slice(0, 20),
    })
})

// ── Clients: list ─────────────────────────────────────────
app.get('/api/clients', auth.requireAuth, async (req, res) => {
    const clients = db.getAllClients.all()

    // Enrich with live Docker status
    const enriched = await Promise.all(clients.map(async (c) => {
        const dockerStatus = c.container_id
            ? await docker.getContainerStatus(c.container_id)
            : { status: 'no_container', running: false }
        return { ...c, docker: dockerStatus }
    }))

    res.json({ clients: enriched })
})

// ── Clients: create ───────────────────────────────────────
app.post('/api/clients', auth.requireAuth, async (req, res) => {
    const { name, slots, storage_gb, password, whatsapp, renewalDate } = req.body

    if (!name || !slots || !storage_gb || !password) {
        return res.status(400).json({ error: 'name, slots, storage_gb, password are required' })
    }
    if (password.length < 4) return res.status(400).json({ error: 'Client password must be at least 4 chars' })

    // Check name uniqueness
    const existing = db.getAllClients.all().find(c => c.name === name)
    if (existing) return res.status(409).json({ error: 'Client name already exists' })

    // Check Docker image
    if (!(await docker.imageExists())) {
        return res.status(500).json({ error: 'qaff-studio:latest Docker image not found. Run: docker build -t qaff-studio:latest /path/to/project' })
    }

    let port
    try { port = db.getNextAvailablePort() } catch (e) {
        return res.status(500).json({ error: e.message })
    }

    // Hash client password
    const passwordHash = await auth.hashPassword(password)

    const info = db.createClient.run({
        name,
        container_id: null,
        container_name: null,
        port,
        slots: parseInt(slots),
        storage_gb: parseInt(storage_gb),
        volume_name: null,
        whatsapp: whatsapp || null,
        renewal_date: renewalDate || null
    })
    const clientId = info.lastInsertRowid

    try {
        const { containerId, containerName, volumeName } = await docker.createClientContainer({
            clientId,
            name,
            port,
            slots: parseInt(slots),
            storageGb: parseInt(storage_gb),
            passwordHash,
        })

        db.updateClientContainer.run(containerId, clientId)
        db.updateClientStatus.run('running', clientId)
        // Also save volume/container name
        const stmt = require('better-sqlite3')(require('path').join(__dirname, 'data', 'admin.db'))
        stmt.prepare(`UPDATE clients SET container_name=?, volume_name=? WHERE id=?`).run(containerName, volumeName, clientId)
        stmt.close()

        db.addLog('client_created', clientId, `Port: ${port}, Slots: ${slots}, Storage: ${storage_gb}GB`)

        const serverIp = getServerIp()
        res.json({
            success: true,
            client: { id: clientId, name, port, slots, storage_gb, status: 'running', whatsapp: whatsapp || null, renewal_date: renewalDate || null },
            url: `http://${serverIp}:${port}`,
        })
    } catch (err) {
        db.deleteClient.run(clientId)
        console.error('[create_client] error:', err)
        res.status(500).json({ error: 'Failed to create Docker container: ' + err.message })
    }
})

// ── Client: start ─────────────────────────────────────────
app.post('/api/clients/:id/start', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (!client.container_id) return res.status(400).json({ error: 'No container associated' })

    try {
        await docker.startContainer(client.container_id)
        db.updateClientStatus.run('running', client.id)
        db.addLog('client_started', client.id, null)
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Client: stop ──────────────────────────────────────────
app.post('/api/clients/:id/stop', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (!client.container_id) return res.status(400).json({ error: 'No container associated' })

    try {
        await docker.stopContainer(client.container_id)
        db.updateClientStatus.run('stopped', client.id)
        db.addLog('client_stopped', client.id, null)
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Client: suspend (HTML interceptor) ───────────────────────────────
app.post('/api/clients/:id/suspend', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    try {
        const passwordHash = await docker.getContainerPasswordHash(client.container_id)
        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            passwordHash,
            isSuspended: true
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run('suspended', client.id)
        db.addLog('client_suspended', client.id, null)
        res.json({ success: true })
    } catch (e) {
        console.error('[suspend] error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Client: unsuspend (resume) ────────────────────────────
app.post('/api/clients/:id/resume', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    try {
        const passwordHash = await docker.getContainerPasswordHash(client.container_id)
        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            passwordHash,
            isSuspended: false
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run('running', client.id)
        db.addLog('client_resumed', client.id, null)
        res.json({ success: true })
    } catch (e) {
        console.error('[resume] error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Client: delete (full) ─────────────────────────────────
app.delete('/api/clients/:id', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    try {
        await docker.deleteClientContainer(client.container_id, client.volume_name)
        db.deleteClient.run(client.id)
        db.addLog('client_deleted', null, `Deleted: ${client.name} (Port: ${client.port})`)
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Client: change password ───────────────────────────────
app.put('/api/clients/:id/password', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' })

    try {
        // Stop → re-create with new password hash
        const passwordHash = await auth.hashPassword(newPassword)
        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            passwordHash,
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run('running', client.id)
        db.addLog('client_password_changed', client.id, null)
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Client: update slots ──────────────────────────────────
app.put('/api/clients/:id/slots', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    const { slots } = req.body
    if (!slots || slots < 1) return res.status(400).json({ error: 'Invalid slots value' })

    try {
        db.updateClientSlots.run(parseInt(slots), client.id)
        db.addLog('client_slots_updated', client.id, `Slots: ${slots}`)

        // Extract original password hash to recreate container seamlessly
        const passwordHash = await docker.getContainerPasswordHash(client.container_id)

        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: parseInt(slots),
            storageGb: client.storage_gb,
            passwordHash,
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run('running', client.id)

        res.json({ success: true })
    } catch (e) {
        console.error('[update_slots] error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Client: update info (whatsapp, renewal) ────────────────
app.put('/api/clients/:id/info', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    const { whatsapp, renewalDate } = req.body

    try {
        db.updateClientInfo.run(whatsapp || null, renewalDate || null, client.id)
        db.addLog('client_info_updated', client.id, `WhatsApp: ${whatsapp}, Renewal: ${renewalDate}`)
        res.json({ success: true })
    } catch (e) {
        console.error('[update_info] error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Helper: get server IP ────────────────────────────────
function getServerIp() {
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address
        }
    }
    return 'localhost'
}

// ── Auto-Suspension Cron (Runs every hour) ────────────────
setInterval(async () => {
    try {
        const clients = db.getAllClients.all().filter(c => c.status === 'running' && c.renewal_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const client of clients) {
            const renewal = new Date(client.renewal_date);
            if (renewal <= today) {
                console.log(`[Cron] Auto-suspending expired client: ${client.name} (ID: ${client.id})`);
                await docker.pauseContainer(client.container_id).catch(e => console.error(e));
                db.updateClientStatus.run('suspended', client.id);
                db.addLog('client_auto_suspended', client.id, `Automatically suspended due to passed renewal date: ${client.renewal_date}`);
            }
        }
    } catch (err) {
        console.error('[Cron] Error running auto-suspension loop:', err);
    }
}, 1000 * 60 * 60); // Check every 60 minutes

// ── Start ──────────────────────────────────────────────────
async function start() {
    await auth.initAdminPassword('Admin123@')
    app.listen(PORT, '0.0.0.0', () => {
        const ip = getServerIp()
        console.log(`\n  ✅ Qaff Admin Panel running at: http://${ip}:${PORT}`)
        console.log(`  🔑 Default password: Admin123@\n`)
    })
}

start().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
