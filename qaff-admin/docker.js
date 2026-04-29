'use strict'
// ── docker.js — Docker Engine control layer ───────────────
const Docker = require('dockerode')

// Connect to Docker via Unix socket (Linux)
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

const QAFF_IMAGE = 'qaff-studio:latest'
const CONTAINER_PREFIX = 'qaff_client_'
const VOLUME_PREFIX = 'qaff_vol_'

/**
 * Check that the qaff-studio Docker image exists
 */
async function imageExists() {
    try {
        await docker.getImage(QAFF_IMAGE).inspect()
        return true
    } catch {
        return false
    }
}

/**
 * Create and start a new client Docker container
 * @param {object} opts
 * @param {number} opts.clientId
 * @param {string} opts.name
 * @param {number} opts.port
 * @param {number} opts.slots
 * @param {number} opts.storageGb
 * @param {string} opts.passwordHash  — bcrypt hash
 * @param {boolean} opts.isSuspended
 * @param {string} opts.renewalDate
 * @param {string} opts.storagePath - optional, 'local' or an absolute path on host
 * @returns {{ containerId, containerName, volumeName, storagePath }}
 */
async function createClientContainer({ clientId, name, port, slots, storageGb, bandwidthLimit = 0, passwordHash, isSuspended = false, renewalDate = '', storagePath = 'local', volumeName }) {
    const containerName = `${CONTAINER_PREFIX}${clientId}`
    
    // Core directory on Primary SSD (Always)
    const primaryBase = `/opt/qaff-data/client_${clientId}`
    const fs = require('fs')
    if (!fs.existsSync(primaryBase)) {
        fs.mkdirSync(primaryBase, { recursive: true })
        try { require('child_process').execSync(`chown -R 1000:1000 "${primaryBase}"`); } catch(e) {}
    }

    let binds = []

    // If the client already has a volumeName and is on 'local', maintain legacy volume support
    if (volumeName && (!storagePath || storagePath === 'local')) {
        binds.push(`${volumeName}:/app/data`)
    } else {
        // Base mount for config, db, logs on SSD
        binds.push(`${primaryBase}:/app/data`)

        // Heavy data mounts (videos, upload, download)
        // If storagePath is not 'local', these points are redirected to the secondary drive
        const dataRoot = (!storagePath || storagePath === 'local') ? primaryBase : storagePath;
        
        // Ensure data directories exist on target drive
        ['videos', 'upload', 'download'].forEach(sub => {
            const fullPath = require('path').join(dataRoot, sub)
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true })
                try { require('child_process').execSync(`chown -R 1000:1000 "${fullPath}"`); } catch(e) {}
            }
            // Nested bind: /app/data/sub maps to the selected drive
            binds.push(`${fullPath}:/app/data/${sub}`)
        })
    }

    // Create the container
    const container = await docker.createContainer({
        name: containerName,
        Image: QAFF_IMAGE,
        Env: [
            `PORT=3000`,
            `TOTAL_SLOTS=${slots}`,
            `MAX_STORAGE_GB=${storageGb}`,
            `ADMIN_PASSWORD_HASH=${passwordHash}`,
            `QAFF_SUSPENDED=${isSuspended ? 'true' : 'false'}`,
            `QAFF_RENEWAL_DATE=${renewalDate}`,
            `QAFF_CLIENT_ID=${clientId}`,
            `QAFF_ADMIN_URL=http://host.docker.internal:4000`,
            `APP_DATA_DIR=/app/data`,
            `VIDEOS_DIR=/app/data/videos`,
            `UPLOAD_DIR=/app/data/upload`,
            `DOWNLOAD_DIR=/app/data/download`,
            `LOGS_DIR=/app/data/logs`,
            `DATABASE_URL=file:/app/data/app.db`,
            `NODE_ENV=production`,
            `HOSTNAME=0.0.0.0`,
            `TZ=Africa/Cairo`,
            `BANDWIDTH_LIMIT_MBPS=${bandwidthLimit}`,
        ],
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: {
            ExtraHosts: ["host.docker.internal:host-gateway"],
            PortBindings: {
                '3000/tcp': [{ HostPort: String(port) }],
            },
            Binds: binds,
            // Needed to execute 'tc' Linux traffic control
            CapAdd: ['NET_ADMIN'],
            // Enhance the kernel TCP stream sockets for huge concurrency loads inside the container isolated namespace
            Sysctls: { 'net.core.somaxconn': '65535' },
            // Disk quota is enforced at OS/volume level via Docker
            RestartPolicy: { Name: 'unless-stopped' },
        },
        Labels: {
            'qaff.managed': 'true',
            'qaff.client_id': String(clientId),
            'qaff.client_name': name,
        },
    })

    await container.start()
    return { containerId: container.id, containerName, volumeName, storagePath }
}

/**
 * Start a stopped container
 */
async function startContainer(containerId) {
    const c = docker.getContainer(containerId)
    await c.start()
}

/**
 * Stop a running container (data is preserved)
 */
async function stopContainer(containerId) {
    const c = docker.getContainer(containerId)
    await c.stop({ t: 10 })
}

/**
 * Pause a container (suspend — freezes process, network blocked at OS level)
 */
async function pauseContainer(containerId) {
    const c = docker.getContainer(containerId)
    await c.pause()
}

/**
 * Unpause a suspended container
 */
async function unpauseContainer(containerId) {
    const c = docker.getContainer(containerId)
    await c.unpause()
}

/**
 * Completely remove a container and its volume
 */
async function deleteClientContainer(containerId, volumeName) {
    try {
        const c = docker.getContainer(containerId)
        const info = await c.inspect().catch(() => null)
        if (info) {
            if (info.State.Running || info.State.Paused) {
                await c.kill().catch(() => { })
            }
            await c.remove({ force: true, v: false })
        }
    } catch (e) {
        console.warn('[docker] container remove warning:', e.message)
    }

    try {
        if (volumeName) {
            const vol = docker.getVolume(volumeName)
            await vol.remove({ force: true })
        }
    } catch (e) {
        console.warn('[docker] volume remove warning:', e.message)
    }
}

/**
 * Get container runtime stats (CPU, memory, status)
 */
async function getContainerStatus(containerId) {
    try {
        const c = docker.getContainer(containerId)
        const info = await c.inspect()
        return {
            status: info.State.Status,   // running | exited | paused
            running: info.State.Running,
            paused: info.State.Paused,
            startedAt: info.State.StartedAt,
        }
    } catch {
        return { status: 'unknown', running: false, paused: false }
    }
}

/**
 * Extract password hash from existing container environment
 */
async function getContainerPasswordHash(containerId) {
    try {
        const c = docker.getContainer(containerId)
        const info = await c.inspect()
        const env = info.Config.Env || []
        const passEnv = env.find(e => e.startsWith('ADMIN_PASSWORD_HASH='))
        return passEnv ? passEnv.split('=')[1] : ''
    } catch {
        return ''
    }
}

/**
 * List all qaff-managed containers
 */
async function listManagedContainers() {
    const containers = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: ['qaff.managed=true'] }),
    })
    return containers
}

/**
 * Fetch active stream count running inside the client container
 */
async function getContainerActiveStreams(containerId) {
    try {
        const c = docker.getContainer(containerId)
        const info = await c.inspect().catch(() => null)
        if (!info || !info.State.Running) return 0;

        // Call the stream-manager /health endpoint which returns { activeStreams: N }
        // Use wget to fetch JSON, then parse the activeStreams number field
        const exec = await c.exec({
            Cmd: ['sh', '-c', 'wget -T 2 -qO- http://127.0.0.1:3002/health 2>/dev/null | grep -o \'"activeStreams":[0-9]*\' | grep -o \'[0-9]*$\''],
            AttachStdout: true, AttachStderr: true
        })
        const stream = await exec.start({ Detached: false })

        return new Promise((resolve) => {
            let output = ''
            
            // Safety timeout to prevent hanging the entire dashboard
            const timeout = setTimeout(() => {
                resolve(0);
            }, 2500);

            stream.on('data', chunk => output += chunk.toString())
            stream.on('end', () => {
                clearTimeout(timeout);
                // Strip any Docker multiplexing header bytes and parse the number
                const cleaned = output.replace(/[^\d]/g, '').trim()
                const count = parseInt(cleaned)
                resolve(isNaN(count) ? 0 : count)
            })
        })
    } catch (e) {
        return 0;
    }
}

/**
 * Get total outbound network bytes (tx_bytes) for a container
 */
async function getContainerNetTx(containerId) {
    try {
        const c = docker.getContainer(containerId)
        const stats = await c.stats({ stream: false })
        let tx = 0
        if (stats.networks) {
            for (const eth in stats.networks) {
                if (eth !== 'lo') tx += stats.networks[eth].tx_bytes
            }
        }
        return tx
    } catch {
        return 0
    }
}

function getDocker() { return docker; }

module.exports = {
    getDocker,
    imageExists,
    createClientContainer,
    startContainer,
    stopContainer,
    pauseContainer,
    unpauseContainer,
    deleteClientContainer,
    getContainerStatus,
    getContainerPasswordHash,
    getContainerActiveStreams,
    getContainerNetTx,
    listManagedContainers
}
