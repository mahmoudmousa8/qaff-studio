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
app.get('/storage', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'storage.html')))

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

// ── Admin: reset password (no auth required, relies on security code) ──
app.post('/api/admin/reset-password', async (req, res) => {
    const { security_code, new_password } = req.body
    if (!security_code || security_code !== 'l27e8q0n') {
        return res.status(401).json({ error: 'رمز الأمان غير صحيح' })
    }
    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل' })
    }

    const hash = await auth.hashPassword(new_password)
    db.upsertAdmin.run(hash)
    db.addLog('admin_password_reset', null, 'Admin password reset using security code')

    res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور بنجاح' })
})

// ── Admin: change password (requires auth AND security code) ───────────
app.post('/api/admin/password', auth.requireAuth, async (req, res) => {
    const { security_code, new_password } = req.body
    if (!security_code || security_code !== 'l27e8q0n') {
        return res.status(401).json({ error: 'رمز الأمان غير صحيح' })
    }
    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل' })
    }

    const hash = await auth.hashPassword(new_password)
    db.upsertAdmin.run(hash)
    db.addLog('admin_password_changed', null, 'Admin password changed from within panel')

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' })
})

// ── Admin: password reset question (global setting) ───────
app.get('/api/settings/reset-question', auth.requireAuth, (req, res) => {
    const question = db.getSettingValue('reset_question', 'من فضلك أدخل رمز الأمان المكون من 5 أحرف الخاص بلوحتك')
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
    const question = db.getSettingValue('reset_question', 'من فضلك أدخل رمز الأمان المكون من 5 أحرف الخاص بلوحتك')
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

// Live Mbps delta: reads NIC bytes twice 500ms apart -> accurate Mbps
function getLiveMbps() {
    return new Promise(resolve => {
        const snap1 = getNetworkUsage()
        setTimeout(() => {
            const snap2 = getNetworkUsage()
            const txDiff = snap2.tx - snap1.tx
            const rxDiff = snap2.rx - snap1.rx
            const outMbps = txDiff >= 0 ? parseFloat(((txDiff * 2 * 8) / 1_000_000).toFixed(2)) : 0
            const inMbps = rxDiff >= 0 ? parseFloat(((rxDiff * 2 * 8) / 1_000_000).toFixed(2)) : 0
            resolve({ outMbps, inMbps, totalTx: snap2.tx, totalRx: snap2.rx })
        }, 500)
    })
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

    // Live network speed + cumulative totals
    const netLive = await getLiveMbps()

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
            net_rx: netLive.totalRx,
            net_tx: netLive.totalTx,
            net_mbps_out: netLive.outMbps,
            net_mbps_in: netLive.inMbps
        },
        logs: logs.slice(0, 20),
    })
})

// Global tracking for per-client live Mbps outbound speed
const clientNetCache = new Map()

// ── Clients: list ─────────────────────────────────────────
app.get('/api/clients', auth.requireAuth, async (req, res) => {
    const clients = db.getAllClients.all()

    // Enrich with live Docker status + active stream count + live mbps out
    const enriched = await Promise.all(clients.map(async (c) => {
        const dockerStatus = c.container_id
            ? await docker.getContainerStatus(c.container_id)
            : { status: 'no_container', running: false }

        let activeStreams = 0
        let mbpsOut = '0.00'

        if (c.container_id && dockerStatus.running) {
            // Get active streams
            activeStreams = await docker.getContainerActiveStreams(c.container_id)

            // Calculate live outbound Mbps over the polling interval
            const txBytes = await docker.getContainerNetTx(c.container_id)
            const now = Date.now()
            const last = clientNetCache.get(c.container_id)

            if (last && now > last.time) {
                const diffBytes = txBytes - last.tx
                const diffSecs = (now - last.time) / 1000
                if (diffBytes > 0 && diffSecs > 0) {
                    mbpsOut = ((diffBytes * 8) / (1024 * 1024) / diffSecs).toFixed(2)
                }
            }
            // Update cache for next polling cycle
            clientNetCache.set(c.container_id, { tx: txBytes, time: now, mbps: mbpsOut })
            // If the poll happened too quickly (e.g. user refreshed immediately), return the last calculated value
            if (last && (now - last.time) < 2000) mbpsOut = last.mbps
        } else {
            clientNetCache.delete(c.container_id)
        }

        return { ...c, docker: dockerStatus, active_streams: activeStreams, live_mbps_out: mbpsOut }
    }))

    res.json({ clients: enriched })
})

// ── Clients: create ───────────────────────────────────────
app.post('/api/clients', auth.requireAuth, async (req, res) => {
    const { name, slots, storage_gb, bandwidth_limit, storage_path } = req.body

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

    // Check disk space
    try {
        const diskusage = require('diskusage');
        const checkPath = (!storage_path || storage_path === 'local') ? '/' : storage_path;
        const info = diskusage.checkSync(checkPath);
        const usagePercent = ((info.total - info.free) / info.total) * 100;
        if (usagePercent >= 90) {
            return res.status(507).json({ error: 'Storage Pool is over 90% full. Cannot create new clients here.'});
        }
    } catch (err) {
        console.error('Disk check error:', err);
    }

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

    const resolvedStoragePath = storage_path || 'local';

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
        reset_answer: reset_answer,
        storage_path: resolvedStoragePath
    })
    const clientId = info.lastInsertRowid

    // Explicitly update bandwidth limit (since it's a new column added post-launch)
    try { db.updateClientBandwidth.run(parseInt(bandwidth_limit || 0), clientId) } catch (e) { }

    try {
        const { containerId, containerName, volumeName, storagePath } = await docker.createClientContainer({
            clientId,
            name,
            port,
            slots: parseInt(slots),
            storageGb: parseInt(storage_gb),
            bandwidthLimit: parseInt(bandwidth_limit || 0),
            passwordHash,
            renewalDate: req.body.renewalDate || '',
            storagePath: resolvedStoragePath
        })

        db.updateClientContainer.run(containerId, clientId)
        db.updateClientStatus.run('running', clientId)
        // Also save volume/container name
        const stmt = require('better-sqlite3')(require('path').join(__dirname, 'data', 'admin.db'))
        stmt.prepare(`UPDATE clients SET container_name=?, volume_name=?, storage_path=? WHERE id=?`).run(containerName, volumeName, storagePath, clientId)
        stmt.close()

        db.addLog('client_created', clientId, `Port: ${port}, Slots: ${slots}, Storage: ${storage_gb}GB, Path: ${storagePath}`)

        const serverIp = getServerIp()
        res.json({
            success: true,
            client: { id: clientId, name, port, slots, storage_gb, status: 'running', whatsapp: req.body.whatsapp || null, renewal_date: req.body.renewalDate || null, storage_path: storagePath },
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
            bandwidthLimit: client.bandwidth_limit || 0,
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
            bandwidthLimit: client.bandwidth_limit || 0,
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
            bandwidthLimit: client.bandwidth_limit || 0,
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
            bandwidthLimit: client.bandwidth_limit || 0,
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
    const { name, whatsapp, renewalDate } = req.body

    try {
        const updateName = name && name.trim() ? name.trim() : client.name
        db.updateClientInfo.run(updateName, whatsapp || null, renewalDate || null, client.id)
        db.addLog('client_info_updated', client.id, `Name: ${updateName}, WhatsApp: ${whatsapp}, Renewal: ${renewalDate}`)

        // Extract original password hash to recreate container seamlessly for new env vars
        const passwordHash = await docker.getContainerPasswordHash(client.container_id)
        await docker.stopContainer(client.container_id).catch(() => { })
        await docker.deleteClientContainer(client.container_id, null) // keep volume

        const { containerId } = await docker.createClientContainer({
            clientId: client.id,
            name: updateName,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            bandwidthLimit: client.bandwidth_limit || 0,
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

// ── Client: update bandwidth ────────────────────────────────
app.put('/api/clients/:id/bandwidth', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    const { bandwidthLimit } = req.body

    try {
        const strictLimit = Math.max(0, parseInt(bandwidthLimit) || 0)
        db.updateClientBandwidth.run(strictLimit, client.id)
        db.addLog('client_bandwidth_updated', client.id, `Bandwidth Limit (Mbps): ${strictLimit}`)

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
            bandwidthLimit: strictLimit,
            passwordHash,
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended'
        })
        db.updateClientContainer.run(containerId, client.id)
        db.updateClientStatus.run(client.status, client.id)

        res.json({ success: true, bandwidth_limit: strictLimit })
    } catch (e) {
        console.error('[update_bandwidth] error:', e)
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
                    bandwidthLimit: client.bandwidth_limit || 0,
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

        let diskTotal = 0, diskUsed = 0, currentOutgoingBandwidthMbps = 0, globalActiveStreams = 0, totalTxBytes = 0, totalRxBytes = 0
        try {
            if (os.platform() !== 'win32') {
                const df = require('child_process').execSync("df -B1 / | tail -1").toString().trim().split(/\s+/)
                diskTotal = parseInt(df[1], 10)
                diskUsed = parseInt(df[2], 10)

                // Read `/proc/net/dev` to calculate live outgoing bandwidth (tx_bytes) and totals
                const readNetStats = () => {
                    try {
                        const netDev = require('fs').readFileSync('/proc/net/dev', 'utf8')
                        // Usually public traffic goes out through eth0 or en*
                        const ethLine = netDev.split('\n').find(line => line.includes('eth') || line.includes('en'))
                        if (ethLine) {
                            const parts = ethLine.trim().split(/\s+/)
                            // col[1]=RxBytes, col[9]=TxBytes in /proc/net/dev
                            return { tx: parseInt(parts[9] || 0, 10), rx: parseInt(parts[1] || 0, 10) }
                        }
                    } catch (e) { }
                    return { tx: 0, rx: 0 }
                }

                const snap1 = readNetStats()
                // Synchronous microscopic sleep to measure delta
                require('child_process').execSync('sleep 0.2')
                const snap2 = readNetStats()

                // Diff in bytes over 0.2 second -> translate to Mbps
                if (snap2.tx >= snap1.tx) {
                    currentOutgoingBandwidthMbps = ((snap2.tx - snap1.tx) * 5 * 8) / 1000000;
                }
                // Expose cumulative totals for monthly usage tracking
                totalTxBytes = snap2.tx
                totalRxBytes = snap2.rx
            }
        } catch (e) { console.error('Disk/Net read error:', e) }

        // Count active broadcast streams concurrently
        try {
            const activeClients = clients.filter(c => c.status === 'running' && c.container_id)
            const streamPromises = activeClients.map(c => docker.getContainerActiveStreams(c.container_id))
            const streamResults = await Promise.all(streamPromises)
            globalActiveStreams = streamResults.reduce((a, b) => a + b, 0)
        } catch (e) { console.error('Failed to parse streams:', e) }

        res.json({
            success: true,
            ram: { total: totalMem, used: usedMem, free: freeMem },
            disk: { total: diskTotal, used: diskUsed, free: diskTotal - diskUsed },
            slots: { totalAllocated: totalAllocatedSlots, activeRunning: totalRunningSlots },
            clients: { total: totalClients, running: runningClients },
            network: {
                outgoingMbps: currentOutgoingBandwidthMbps.toFixed(2),
                totalTxBytes: totalTxBytes,
                totalRxBytes: totalRxBytes
            },
            streams: { active: globalActiveStreams }
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

// ── Storage Pools ──────────────────────────────────────────

function getPoolInfo(name, pathStr, isPrimary) {
    try {
        const fs = require('fs');
        // Use native statfsSync (Node 18+) — no external package required
        const stat = fs.statfsSync(pathStr);
        const blockSize = Number(stat.bsize);
        const total = Number(stat.blocks) * blockSize;
        const free  = Number(stat.bfree)  * blockSize;
        const available = Number(stat.bavail) * blockSize;
        const used  = total - free;
        return {
            name,
            path: pathStr,
            isPrimary,
            total,
            free,
            available,
            used,
            usagePercent: Math.round((used / total) * 100)
        }
    } catch (e) {
        console.error('[getPoolInfo] error for path', pathStr, e.message);
        return null;
    }
}

app.get('/api/system/storage-pools', auth.requireAuth, (req, res) => {
    const fs = require('fs');
    const pools = [];

    // Primary pool — always present
    const p1 = getPoolInfo('Primary Disk', '/', true);
    if (p1) pools.push(p1);

    // Secondary pool — detect /mnt/storage (mounted extra disk)
    const secondaryRoot = '/mnt/storage';
    const secondaryData = `${secondaryRoot}/qaff-data`;
    if (fs.existsSync(secondaryRoot)) {
        // Auto-create qaff-data dir if missing
        if (!fs.existsSync(secondaryData)) {
            try { fs.mkdirSync(secondaryData, { recursive: true }); } catch (_) {}
        }
        // Only add if it's a real separate filesystem (different device from /)
        const rootStat  = fs.statfsSync('/');
        const mntStat   = fs.statfsSync(secondaryRoot);
        // If blocks or fsid differ, it's a separate mount
        if (Number(mntStat.blocks) !== Number(rootStat.blocks)) {
            const p2 = getPoolInfo('Secondary Disk (/mnt/storage)', secondaryData, false);
            if (p2) pools.push(p2);
        }
    }

    const clients = db.getAllClients.all();
    for (const p of pools) {
        if (p.isPrimary) {
            p.clientCount = clients.filter(c => !c.storage_path || c.storage_path === 'local').length;
        } else {
            p.clientCount = clients.filter(c => c.storage_path && c.storage_path.startsWith(p.path)).length;
        }
    }
    res.json({ pools });
})

app.post('/api/clients/:id/migrate', auth.requireAuth, async (req, res) => {
    const { targetPool } = req.body;
    const client = db.getClientById.get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const currentPath = client.storage_path || 'local';
    if (currentPath === targetPool || (currentPath !== 'local' && currentPath.startsWith(targetPool))) {
        return res.status(400).json({ error: 'Client is already on the target storage pool' });
    }

    try {
        const fs = require('fs');
        const checkPath = targetPool === 'local' ? '/' : targetPool;
        const stat = fs.statfsSync(checkPath);
        const used = (Number(stat.blocks) - Number(stat.bfree)) * Number(stat.bsize);
        const total = Number(stat.blocks) * Number(stat.bsize);
        const usagePercent = (used / total) * 100;
        if (usagePercent >= 90) {
            return res.status(507).json({ error: 'Target Storage Pool is over 90% full. Cannot migrate here.'});
        }
    } catch (err) {
        console.error('Disk check error:', err);
    }

    try {
        await docker.stopContainer(client.container_id).catch(() => { });

        // Ensure volume exists to read its TRUE mountpoint
        await docker.getDocker().createVolume({ Name: `qaff_vol_${client.id}` }).catch(() => { });
        const volInspect = await docker.getDocker().getVolume(`qaff_vol_${client.id}`).inspect().catch(() => null);
        const localVolumeMountpoint = volInspect ? volInspect.Mountpoint : `/var/lib/docker/volumes/qaff_vol_${client.id}/_data`;

        const srcDir = currentPath === 'local'
            ? `${localVolumeMountpoint}/`
            : `${currentPath}/`;

        let targetPathStr = '';
        let destDir = '';
        if (targetPool === 'local') {
            targetPathStr = 'local';
            destDir = `${localVolumeMountpoint}/`;
        } else {
            targetPathStr = `${targetPool}/client_${client.id}`;
            require('fs').mkdirSync(targetPathStr, { recursive: true });
            require('child_process').execSync(`chown -R 1000:1000 "${targetPathStr}"`);
            destDir = `${targetPathStr}/`;
        }

        db.addLog('migration_started', client.id, `From ${currentPath} to ${targetPathStr}`);

        // Safe trailing slashes for rsync
        require('child_process').execSync(`rsync -acv "${srcDir}" "${destDir}"`);

        // Backup old dir
        const srcNoSlash = srcDir.replace(/\/$/, '');
        const backupPath = srcNoSlash + '.backup_' + Date.now();
        require('child_process').execSync(`mv "${srcNoSlash}" "${backupPath}"`);

        const passwordHash = await docker.getContainerPasswordHash(client.container_id).catch(() => null);
        await docker.deleteClientContainer(client.container_id, null);

        const { containerId, containerName, volumeName, storagePath } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            bandwidthLimit: client.bandwidth_limit || 0,
            passwordHash: passwordHash || '',
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended',
            storagePath: targetPathStr
        });

        // Health Check & Auto-Rollback
        const checkContainer = await docker.getDocker().getContainer(containerId).inspect().catch(() => null);
        if (!checkContainer || !checkContainer.State || !checkContainer.State.Running) {
            db.addLog('migration_failed', client.id, `Container failed to start on new pool. Initiating auto-rollback...`);
            await docker.deleteClientContainer(containerId, null).catch(() => {});
            
            if (currentPath === 'local') {
                 await docker.getDocker().createVolume({ Name: `qaff_vol_${client.id}` }).catch(() => { });
            } else {
                 require('fs').mkdirSync(currentPath, { recursive: true });
                 require('child_process').execSync(`chown -R 1000:1000 "${currentPath}"`);
            }
            
            require('child_process').execSync(`rsync -acv "${backupPath}/" "${srcDir}"`);
            
            const orig = await docker.createClientContainer({
                clientId: client.id, name: client.name, port: client.port, slots: client.slots,
                storageGb: client.storage_gb, bandwidthLimit: client.bandwidth_limit || 0,
                passwordHash: passwordHash || '', renewalDate: client.renewal_date || '',
                isSuspended: client.status === 'suspended', storagePath: currentPath === 'local' ? 'local' : `${currentPath}/`
            });
            
            db.updateClientContainer.run(orig.containerId, client.id);
            db.addLog('client_rolled_back', client.id, `Auto-rollback completed successfully after migration failure.`);
            return res.status(500).json({ error: 'Migration failed. Container did not start correctly on the new storage. System auto-rolled back safely.'});
        }

        db.updateClientContainer.run(containerId, client.id);
        db.updateClientStoragePath.run(storagePath, volumeName, backupPath, client.id);
        db.addLog('client_migrated', client.id, `Success. Old data backed up at ${backupPath}`);

        res.json({ success: true, storagePath, backupPath });
    } catch (err) {
        db.addLog('migration_failed', client.id, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients/:id/rollback', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.backup_path) return res.status(400).json({ error: 'No backup path available' });

    try {
        await docker.stopContainer(client.container_id).catch(() => { });

        // Original path depends on where the backup is located
        const backupIsLocal = client.backup_path.includes('/volumes/qaff_vol_');
        const targetPathStr = backupIsLocal ? 'local' : client.backup_path.replace(/\.backup_.+$/, '');
        
        await docker.getDocker().createVolume({ Name: `qaff_vol_${client.id}` }).catch(() => { });
        const volInspect = await docker.getDocker().getVolume(`qaff_vol_${client.id}`).inspect().catch(() => null);
        const localVolumeMountpoint = volInspect ? volInspect.Mountpoint : `/var/lib/docker/volumes/qaff_vol_${client.id}/_data`;

        let actualBackupPath = client.backup_path;
        if (actualBackupPath.startsWith('/var/lib/docker/')) {
            const backupSuffixMatch = actualBackupPath.match(/\.backup_\d+/);
            if (backupSuffixMatch) {
                actualBackupPath = localVolumeMountpoint.replace(/\/$/, '') + backupSuffixMatch[0];
            }
        }

        let destDir = backupIsLocal ? `${localVolumeMountpoint}/` : `${targetPathStr}/`;

        if (!backupIsLocal) {
            require('fs').mkdirSync(targetPathStr, { recursive: true });
            require('child_process').execSync(`chown -R 1000:1000 "${targetPathStr}"`);
        }

        db.addLog('rollback_started', client.id, `Restoring from ${actualBackupPath}`);
        require('child_process').execSync(`rsync -acv "${actualBackupPath}/" "${destDir}"`);

        const passwordHash = await docker.getContainerPasswordHash(client.container_id).catch(() => null);
        await docker.deleteClientContainer(client.container_id, null);

        const { containerId, containerName, volumeName, storagePath } = await docker.createClientContainer({
            clientId: client.id,
            name: client.name,
            port: client.port,
            slots: client.slots,
            storageGb: client.storage_gb,
            bandwidthLimit: client.bandwidth_limit || 0,
            passwordHash: passwordHash || '',
            renewalDate: client.renewal_date || '',
            isSuspended: client.status === 'suspended',
            storagePath: targetPathStr
        });

        db.updateClientContainer.run(containerId, client.id);
        db.updateClientStoragePath.run(storagePath, volumeName, null, client.id); // clear backup
        db.addLog('client_rolled_back', client.id, `Success. Target path ${storagePath}`);

        res.json({ success: true, storagePath });
    } catch (err) {
        db.addLog('rollback_failed', client.id, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id/backup', auth.requireAuth, async (req, res) => {
    const client = db.getClientById.get(req.params.id);
    if (!client || !client.backup_path) return res.status(404).json({ error: 'No backup found' });

    try {
        if (!client.backup_path.includes('.backup_')) throw new Error('Safety guard: invalid backup path format');
        
        let actualBackupPath = client.backup_path;
        if (actualBackupPath.startsWith('/var/lib/docker/')) {
            await docker.getDocker().createVolume({ Name: `qaff_vol_${client.id}` }).catch(() => { });
            const volInspect = await docker.getDocker().getVolume(`qaff_vol_${client.id}`).inspect().catch(() => null);
            const localVolumeMountpoint = volInspect ? volInspect.Mountpoint : `/var/lib/docker/volumes/qaff_vol_${client.id}/_data`;
            const backupSuffixMatch = actualBackupPath.match(/\.backup_\d+/);
            if (backupSuffixMatch) {
                actualBackupPath = localVolumeMountpoint.replace(/\/$/, '') + backupSuffixMatch[0];
            }
        }

        require('child_process').execSync(`rm -rf "${actualBackupPath}"`);
        db.updateClientBackupPath.run(null, client.id);
        db.addLog('backup_deleted', client.id, `Permanently deleted ${actualBackupPath}`);
        res.json({ success: true });
    } catch (err) {
        db.addLog('backup_delete_failed', client.id, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── System: Pull + Rebuild Docker Image + Update All Clients ──
app.post('/api/system/rebuild', auth.requireAuth, async (req, res) => {
    const projectDir = '/opt/qaff-studio'
    res.json({ success: true, message: 'Rebuild started. Check server logs for progress.' })

    setTimeout(async () => {
        try {
            console.log('[rebuild] Pulling latest code from GitHub (Hard Reset)...')
            // Add safe directory config just in case of ownership issues
            execSync(`git config --global --add safe.directory "${projectDir}"`, { stdio: 'inherit' })
            execSync(`git -C "${projectDir}" fetch origin main`, { stdio: 'inherit' })
            execSync(`git -C "${projectDir}" reset --hard origin/main`, { stdio: 'inherit' })

            console.log('[rebuild] Rebuilding Docker image qaff-studio:latest...')
            execSync(`docker build -t qaff-studio:latest "${projectDir}"`, { stdio: 'inherit' })
            console.log('[rebuild] Docker image rebuilt.')

            // Recreate all running clients from the new image
            const clients = db.getAllClients.all()
            let upgraded = 0, failed = 0
            for (const client of clients) {
                if (!client.container_id) continue
                try {
                    const passwordHash = await docker.getContainerPasswordHash(client.container_id).catch(() => null)
                    if (!passwordHash) { failed++; continue }
                    await docker.stopContainer(client.container_id).catch(() => { })
                    await docker.deleteClientContainer(client.container_id, null)
                    const { containerId } = await docker.createClientContainer({
                        clientId: client.id,
                        name: client.name,
                        port: client.port,
                        slots: client.slots,
                        storageGb: client.storage_gb,
                        bandwidthLimit: client.bandwidth_limit || 0,
                        passwordHash,
                        renewalDate: client.renewal_date || '',
                        isSuspended: client.status === 'suspended',
                        storagePath: client.storage_path || 'local'
                    })
                    db.updateClientContainer.run(containerId, client.id)
                    upgraded++
                } catch (err) {
                    console.error(`[rebuild] client ${client.id} failed:`, err)
                    failed++
                }
            }
            db.addLog('system_rebuild', null, `Rebuilt image. Upgraded: ${upgraded}, Failed: ${failed}`)
            console.log(`[rebuild] Done. Upgraded: ${upgraded}, Failed: ${failed}`)
        } catch (err) {
            console.error('[rebuild] Fatal error:', err)
            db.addLog('system_rebuild_failed', null, err.message)
        }
    }, 100)
})

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
