'use strict'
// ── server.js — Qaff Admin Master Panel ───────────────────
const express = require('express')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { execSync } = require('child_process')

const db = require('./db')
const auth = require('./auth')
const docker = require('./docker')

function generateRandomString(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

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

// ── Admin Password route removed per user request ───────────

// ── Admin: password reset question (global setting) ───────
app.get('/api/settings/reset-question', auth.requireAuth, (req, res) => {
    const question = db.getSettingValue('reset_question', '')
    res.json({ question })
})

app.put('/api/settings/reset-question', auth.requireAuth, (req, res) => {
    const { question } = req.body
    if (!question || !question.trim()) return res.status(400).json({ error: 'Question text is required' })
    db.upsertSetting.run('reset_question', question.trim())
    db.addLog('admin_changed_reset_question', null, 'Password reset question updated')
    res.json({ success: true })
})

// ── Internal: get reset question (no auth — for client containers) ───
app.get('/api/internal/reset-question', (req, res) => {
    const question = db.getSettingValue('reset_question', '')
    res.json({ question })
})

// ── Dashboard stats ───────────────────────────────────────
function getCpuUsage() {
    return new Promise(res => {
        const start = os.cpus()
        setTimeout(() => {
            const end = os.cpus()
            let idleDiff = 0, totalDiff = 0
            for (let i = 0; i < start.length; i++) {
                const s = start[i].times, e = end[i].times
                const sTotal = Object.values(s).reduce((a, b) => a + b, 0)
                const eTotal = Object.values(e).reduce((a, b) => a + b, 0)
                idleDiff += (e.idle - s.idle)
                totalDiff += (eTotal - sTotal)
            }
            res(totalDiff === 0 ? 0 : Math.round(100 - (idleDiff / totalDiff) * 100))
        }, 100)
    })
}

function getNetworkUsage() {
    try {
        const data = fs.readFileSync('/proc/net/dev', 'utf8')
        const lines = data.split('\n')
        let rx = 0, tx = 0
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue
            const parts = line.split(/\s+/)
            const interfaceName = parts[0].replace(':', '')
            if (interfaceName === 'lo') continue
            rx += parseInt(parts[1] || 0)
            tx += parseInt(parts[9] || 0)
        }
        return { rx, tx }
    } catch {
        return { rx: 0, tx: 0 }
    }
}

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

    // RAM Info
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memUsagePercent = Math.round((usedMem / totalMem) * 100)

    // CPU Info
    const cpuUsagePercent = await getCpuUsage()

    // Network Info
    const net = getNetworkUsage()

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
        system: {
            cpu_percent: cpuUsagePercent,
            ram_total: totalMem,
            ram_used: usedMem,
            ram_free: freeMem,
            ram_percent: memUsagePercent,
            net_rx: net.rx,
            net_tx: net.tx
        },
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
    const { name, slots, storage_gb } = req.body

    if (!name || !slots || !storage_gb) {
        return res.status(400).json({ error: 'name, slots, storage_gb are required' })
    }

    const randHash = (len) => Array.from({ length: len }, () => "0123456789".charAt(Math.floor(Math.random() * 10))).join('');
    const reset_answer = req.body.reset_answer || randHash(5);
    const password = req.body.password || Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36))).join('');

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
        whatsapp: req.body.whatsapp || null,
        renewal_date: req.body.renewalDate || null,
        password: password,
        reset_answer: reset_answer
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
            renewalDate: req.body.renewalDate || ''
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
            client: { id: clientId, name, port, slots, storage_gb, status: 'running', whatsapp: req.body.whatsapp || null, renewal_date: req.body.renewalDate || null },
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
            isSuspended: true,
            renewalDate: client.renewal_date || ''
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
            isSuspended: false,
            renewalDate: client.renewal_date || ''
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
        db.updateClientPassword.run(newPassword, client.id)

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
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended'
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
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended'
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

        // Extract original password hash to recreate container seamlessly for new env vars
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
            renewalDate: renewalDate || '',
            isSuspended: client.status === 'suspended'
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run(client.status, client.id)

        res.json({ success: true })
    } catch (e) {
        console.error('[update_info] error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Clients: update all containers ──────────────────────────
app.post('/api/clients/update-all', auth.requireAuth, async (req, res) => {
    try {
        const clients = db.getAllClients.all()
        let upgraded = 0
        let failed = 0

        for (const client of clients) {
            if (!client.container_id) continue;

            try {
                // Read original hash
                const passwordHash = await docker.getContainerPasswordHash(client.container_id).catch(() => null)
                if (!passwordHash) { failed++; continue; }

                // Stop & Remove matching exact existing schema logic
                await docker.stopContainer(client.container_id).catch(() => { })
                await docker.deleteClientContainer(client.container_id, null) // keep volume

                // Recreate with qaff-studio:latest
                const { containerId } = await docker.createClientContainer({
                    clientId: client.id,
                    name: client.name,
                    port: client.port,
                    slots: client.slots,
                    storageGb: client.storage_gb,
                    passwordHash,
                    renewalDate: client.renewal_date || '',
                    isSuspended: client.status === 'suspended'
                })

                db.updateClientContainer.run(containerId, client.id)
                upgraded++;
            } catch (err) {
                console.error(`[bulk update] failed to upgrade client ${client.id}:`, err)
                failed++;
            }
        }

        db.addLog('bulk_update', null, `Bulk updated ${upgraded} client containers. Failed: ${failed}`)
        res.json({ success: true, upgraded, failed })
    } catch (e) {
        console.error('[bulk update] fatal error:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Server: System Stats (Admin Only) ─────────────────────
app.get('/api/system-stats', auth.requireAuth, async (req, res) => {
    try {
        const clients = db.getAllClients.all()
        let totalAllocatedSlots = 0
        let totalRunningSlots = 0
        let totalClients = clients.length
        let runningClients = 0

        clients.forEach(c => {
            totalAllocatedSlots += c.slots
            if (c.status === 'running') {
                totalRunningSlots += c.slots
                runningClients++
            }
        })

        const totalMem = os.totalmem()
        const freeMem = os.freemem()
        const usedMem = totalMem - freeMem

        let diskTotal = 0, diskUsed = 0
        try {
            if (os.platform() !== 'win32') {
                const df = require('child_process').execSync("df -B1 / | tail -1").toString().trim().split(/\s+/)
                diskTotal = parseInt(df[1], 10)
                diskUsed = parseInt(df[2], 10)
            }
        } catch (e) { console.error('Disk read error:', e) }

        res.json({
            success: true,
            ram: { total: totalMem, used: usedMem, free: freeMem },
            disk: { total: diskTotal, used: diskUsed, free: diskTotal - diskUsed },
            slots: { totalAllocated: totalAllocatedSlots, activeRunning: totalRunningSlots },
            clients: { total: totalClients, running: runningClients }
        })
    } catch (e) {
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

// ── Client: admin override security code ──────────────────
app.put('/api/clients/:id/security-code', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    const { resetAnswer } = req.body
    if (!resetAnswer) return res.status(400).json({ error: 'resetAnswer is required' })

    try {
        db.updateClientResetAnswer.run(resetAnswer, client.id)
        db.addLog('admin_changed_security_code', client.id, 'Reset answer updated manually by admin')
        res.json({ success: true })
    } catch (e) {
        console.error('[security code override error]:', e)
        res.status(500).json({ error: e.message })
    }
})

// ── Client: internal change password (from container) ─────
app.post('/api/internal/change-password', async (req, res) => {
    const { clientId, resetAnswer, newPassword } = req.body
    if (!clientId || !resetAnswer || !newPassword) return res.status(400).json({ error: 'Missing fields' })

    const client = db.getClientById.get(clientId)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    // Check lockout
    if (client.reset_lockout_until && new Date(client.reset_lockout_until) > new Date()) {
        return res.status(403).json({ error: 'Account locked out. Try again later.' })
    }

    if (client.reset_answer !== resetAnswer) {
        const failures = (client.reset_failures || 0) + 1
        if (failures >= 5) {
            const lockoutDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            db.updateClientLockout.run(failures, lockoutDate, client.id)
            return res.status(403).json({ error: 'Account locked due to 5 failed attempts. Please try again after 24 hours.' })
        } else {
            db.updateClientLockout.run(failures, null, client.id)
            return res.status(401).json({ error: 'Incorrect reset answer' })
        }
    }

    try {
        const newPasswordHash = await auth.hashPassword(newPassword)
        db.updateClientPassword.run(newPassword, client.id) // Changed from updateClientSecurity
        db.addLog('client_changed_password', client.id, 'Client successfully changed their own password')

        // Asynchronously recreate container
        if (client.container_id) {
            (async () => {
                try {
                    await docker.stopContainer(client.container_id).catch(() => { })
                    await docker.deleteClientContainer(client.container_id, null)
                    const { containerId } = await docker.createClientContainer({
                        clientId: client.id,
                        name: client.name,
                        port: client.port,
                        slots: client.slots,
                        storageGb: client.storage_gb,
                        passwordHash: newPasswordHash,
                        isSuspended: client.status === 'suspended',
                        renewalDate: client.renewal_date || ''
                    })
                    db.updateClientContainer.run(containerId, client.id)
                } catch (err) {
                    console.error('[Internal Password Change] Failed to recreate container:', err)
                }
            })()
        }

        res.json({ success: true })
    } catch (e) {
        console.error('[internal change pw error]:', e)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// ── Logs ──────────────────────────────────────────────────
// Update Client Storage
app.put('/api/clients/:id/storage', auth.requireAuth, async (req, res) => {
    const { storage_gb } = req.body;
    const { id } = req.params;
    if (!storage_gb || storage_gb < 1) return res.status(400).json({ error: 'Invalid storage' });
    try {
        const client = db.getClientById.get(id);
        if (!client) return res.status(404).json({ error: 'Not found' });
        db.updateClientStorage.run(storage_gb, id);
        db.addLog('client_storage_updated', client.id, `Storage: ${storage_gb}GB`);

        // Extract original password hash to recreate container seamlessly
        const passwordHash = await docker.getContainerPasswordHash(client.container_id)

        // Recreate container for limits (even though storage is volume-bound, we restart to be clean)
        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: parseInt(storage_gb),
            passwordHash,
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended'
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run(client.status, client.id)

        res.json({ success: true });
    } catch (e) {
        console.error('[update_storage] error:', e)
        res.status(500).json({ error: e.message })
    }
});

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
