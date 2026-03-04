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
 * @returns {{ containerId, containerName, volumeName }}
 */
async function createClientContainer({ clientId, name, port, slots, storageGb, passwordHash, isSuspended = false, renewalDate = '' }) {
    const containerName = `${CONTAINER_PREFIX}${clientId}`
    const volumeName = `${VOLUME_PREFIX}${clientId}`

    // Create volume for client data
    await docker.createVolume({
        Name: volumeName,
        Labels: { 'qaff.client_id': String(clientId), 'qaff.client_name': name },
    })

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
            `DATABASE_URL=file:/data/app.db`,
            `NODE_ENV=production`,
            `HOSTNAME=0.0.0.0`,
        ],
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: {
            ExtraHosts: ["host.docker.internal:host-gateway"],
            PortBindings: {
                '3000/tcp': [{ HostPort: String(port) }],
            },
            Binds: [`${volumeName}:/app/data`],
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
    return { containerId: container.id, containerName, volumeName }
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
 * Restart a container (used after changing ENV vars via recreate)
 */
async function restartContainer(containerId) {
    const c = docker.getContainer(containerId)
    await c.restart({ t: 10 })
}

module.exports = {
    imageExists,
    createClientContainer,
    startContainer,
    stopContainer,
    pauseContainer,
    unpauseContainer,
    deleteClientContainer,
    getContainerStatus,
    getContainerPasswordHash,
    listManagedContainers,
    restartContainer,
}
