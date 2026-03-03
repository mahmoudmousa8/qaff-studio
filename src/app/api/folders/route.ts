import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, rmdirSync, unlinkSync, copyFileSync } from 'fs'
import path from 'path'
import { VIDEOS_DIR } from '@/lib/paths'

// Helper function to recursively get all folders
function getAllFoldersRecursive(dir: string, basePath: string = ''): { path: string; displayPath: string }[] {
  const results: { path: string; displayPath: string }[] = []

  if (!existsSync(dir)) return results

  const items = readdirSync(dir)

  for (const item of items) {
    const itemPath = path.join(dir, item)
    const stats = statSync(itemPath)

    if (stats.isDirectory()) {
      const relativePath = basePath ? `${basePath}/${item}` : item
      results.push({
        path: relativePath,
        displayPath: relativePath
      })

      // Recursively get subfolders
      const subfolders = getAllFoldersRecursive(itemPath, relativePath)
      results.push(...subfolders)
    }
  }

  return results
}

// Security: ensure resolved path is within base
function isWithinBase(target: string, base: string): boolean {
  const resolvedTarget = path.resolve(target)
  const resolvedBase = path.resolve(base)
  return resolvedTarget.startsWith(resolvedBase)
}

// Sanitize name: only strip filesystem-unsafe chars, preserve Unicode/Arabic
function sanitizeName(name: string): string {
  // Remove only chars that are illegal in most filesystems
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

// GET - List folders and videos
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const currentFolder = searchParams.get('folder') || ''
    const allFolders = searchParams.get('all') === 'true'

    // If requesting all folders for dropdown
    if (allFolders) {
      if (!existsSync(VIDEOS_DIR)) {
        mkdirSync(VIDEOS_DIR, { recursive: true })
        return NextResponse.json({ allFolders: [] })
      }

      const folders = getAllFoldersRecursive(VIDEOS_DIR)
      return NextResponse.json({
        allFolders: folders.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
      })
    }

    // Determine the directory to browse
    const browseDir = currentFolder
      ? path.join(VIDEOS_DIR, currentFolder)
      : VIDEOS_DIR

    // Security check
    if (!isWithinBase(browseDir, VIDEOS_DIR)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 })
    }

    const resolvedPath = path.resolve(browseDir)

    if (!existsSync(resolvedPath)) {
      mkdirSync(resolvedPath, { recursive: true })
      return NextResponse.json({ folders: [], videos: [], currentFolder, parentFolder: null })
    }

    const items = readdirSync(resolvedPath)
    const folders: { name: string; path: string; videoCount: number }[] = []
    const videos: { name: string; path: string; size: number; sizeFormatted: string; modified: string }[] = []

    const allowedExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.ts']

    for (const item of items) {
      const itemPath = path.join(resolvedPath, item)
      const stats = statSync(itemPath)

      if (stats.isDirectory()) {
        // Count videos in folder
        const folderItems = existsSync(itemPath) ? readdirSync(itemPath) : []
        const videoCount = folderItems.filter(f => {
          try {
            const fStat = statSync(path.join(itemPath, f))
            return fStat.isDirectory() || allowedExtensions.includes(path.extname(f).toLowerCase())
          } catch {
            return false
          }
        }).length

        folders.push({
          name: item,
          path: itemPath,
          videoCount
        })
      } else if (allowedExtensions.includes(path.extname(item).toLowerCase())) {
        const sizeMB = stats.size / (1024 * 1024)
        const sizeFormatted = sizeMB >= 1024
          ? (sizeMB / 1024).toFixed(2) + ' GB'
          : sizeMB.toFixed(2) + ' MB'

        videos.push({
          name: item,
          path: itemPath,
          size: stats.size,
          sizeFormatted,
          modified: stats.mtime.toISOString()
        })
      }
    }

    // Calculate parent folder
    const parentFolder = currentFolder ?
      (currentFolder.includes('/') ? currentFolder.substring(0, currentFolder.lastIndexOf('/')) : '')
      : null

    return NextResponse.json({
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      videos: videos.sort((a, b) => b.modified.localeCompare(a.modified)),
      currentFolder,
      parentFolder,
      currentPath: resolvedPath
    })
  } catch (error) {
    console.error('Error listing:', error)
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 })
  }
}

// POST - Various operations
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, name, newName, sourcePath, targetFolder, itemPath, currentFolder } = body

    // Base directory for operations (respects current folder context)
    const baseDir = currentFolder ? path.join(VIDEOS_DIR, currentFolder) : VIDEOS_DIR

    switch (action) {
      case 'create': {
        // Create folder in current location
        const sanitizedName = sanitizeName(name)
        if (!sanitizedName) {
          return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 })
        }
        const folderPath = path.join(baseDir, sanitizedName)

        // Security: no path traversal
        if (!isWithinBase(folderPath, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 })
        }

        if (existsSync(folderPath)) {
          return NextResponse.json({ error: 'Folder already exists' }, { status: 400 })
        }
        mkdirSync(folderPath, { recursive: true })
        return NextResponse.json({ success: true, message: 'Folder created' })
      }

      case 'rename': {
        // Rename folder or video
        if (!itemPath || !newName) {
          return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        if (!existsSync(itemPath)) {
          return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        // Security: validate newName doesn't contain path separators
        if (newName.includes('/') || newName.includes('\\')) {
          return NextResponse.json({ error: 'Name cannot contain path separators' }, { status: 400 })
        }

        const dir = path.dirname(itemPath)
        const oldName = path.basename(itemPath)
        const stats = statSync(itemPath)

        let finalNewName: string

        if (stats.isFile()) {
          // ⚠️ EXTENSION PROTECTION: Extension MUST NOT change
          const oldExt = path.extname(oldName).toLowerCase()
          const newExt = path.extname(newName).toLowerCase()

          if (newExt && newExt !== oldExt) {
            return NextResponse.json({
              error: `Extension change not allowed. Original extension "${oldExt}" must be preserved.`
            }, { status: 400 })
          }

          // If user provided name without extension, append original extension
          const nameWithoutExt = newExt ? path.basename(newName, newExt) : newName
          const sanitized = sanitizeName(nameWithoutExt)
          if (!sanitized) {
            return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
          }
          finalNewName = sanitized + oldExt
        } else {
          // For directories, just sanitize
          finalNewName = sanitizeName(newName)
          if (!finalNewName) {
            return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 })
          }
        }

        const newPath = path.join(dir, finalNewName)

        // Security: must stay within VIDEOS_DIR
        if (!isWithinBase(newPath, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
        }

        if (existsSync(newPath) && newPath !== itemPath) {
          return NextResponse.json({ error: 'Item with this name already exists' }, { status: 400 })
        }

        renameSync(itemPath, newPath)
        return NextResponse.json({ success: true, message: 'Renamed successfully', newPath })
      }

      case 'delete': {
        // Delete folder or video
        if (!itemPath) {
          return NextResponse.json({ error: 'Missing itemPath' }, { status: 400 })
        }

        // Security check
        if (!isWithinBase(itemPath, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
        }

        if (!existsSync(itemPath)) {
          return NextResponse.json({ error: 'Item not found' }, { status: 404 })
        }

        const deleteStats = statSync(itemPath)
        if (deleteStats.isDirectory()) {
          const items = readdirSync(itemPath)
          if (items.length > 0) {
            return NextResponse.json({ error: 'Folder is not empty. Delete contents first.' }, { status: 400 })
          }
          rmdirSync(itemPath)
        } else {
          unlinkSync(itemPath)
        }

        return NextResponse.json({ success: true, message: 'Deleted successfully' })
      }

      case 'copy': {
        // Copy video to folder
        if (!sourcePath) {
          return NextResponse.json({ error: 'Missing sourcePath' }, { status: 400 })
        }

        if (!isWithinBase(sourcePath, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid source path' }, { status: 400 })
        }

        if (!existsSync(sourcePath)) {
          return NextResponse.json({ error: 'Source file not found' }, { status: 404 })
        }

        const sourceName = path.basename(sourcePath)
        // Handle __ROOT__ as empty (root folder)
        const actualTargetFolder = targetFolder === '__ROOT__' ? '' : targetFolder
        const targetDir = actualTargetFolder ? path.join(VIDEOS_DIR, actualTargetFolder) : VIDEOS_DIR

        if (!isWithinBase(targetDir, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid target path' }, { status: 400 })
        }

        // Ensure target directory exists
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true })
        }

        let targetPath = path.join(targetDir, sourceName)

        // Handle duplicate names
        if (existsSync(targetPath) && targetPath !== sourcePath) {
          const ext = path.extname(sourceName)
          const baseName = path.basename(sourceName, ext)
          const timestamp = Date.now()
          targetPath = path.join(targetDir, `${baseName}_copy_${timestamp}${ext}`)
        }

        copyFileSync(sourcePath, targetPath)

        return NextResponse.json({
          success: true,
          message: 'Copied successfully',
          newPath: targetPath
        })
      }

      case 'move': {
        // Move video to folder
        if (!sourcePath) {
          return NextResponse.json({ error: 'Missing sourcePath' }, { status: 400 })
        }

        if (!isWithinBase(sourcePath, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid source path' }, { status: 400 })
        }

        if (!existsSync(sourcePath)) {
          return NextResponse.json({ error: 'Source file not found' }, { status: 404 })
        }

        const moveSourceName = path.basename(sourcePath)
        // Handle __ROOT__ as empty (root folder)
        const actualMoveTargetFolder = targetFolder === '__ROOT__' ? '' : targetFolder
        const moveTargetDir = actualMoveTargetFolder ? path.join(VIDEOS_DIR, actualMoveTargetFolder) : VIDEOS_DIR

        if (!isWithinBase(moveTargetDir, VIDEOS_DIR)) {
          return NextResponse.json({ error: 'Invalid target path' }, { status: 400 })
        }

        // Ensure target directory exists
        if (!existsSync(moveTargetDir)) {
          mkdirSync(moveTargetDir, { recursive: true })
        }

        let moveTargetPath = path.join(moveTargetDir, moveSourceName)

        // If source and target are the same, nothing to do
        if (moveTargetPath === sourcePath) {
          return NextResponse.json({
            success: true,
            message: 'File is already in the target location',
            newPath: sourcePath
          })
        }

        // Handle duplicate names
        if (existsSync(moveTargetPath)) {
          const ext = path.extname(moveSourceName)
          const baseName = path.basename(moveSourceName, ext)
          const timestamp = Date.now()
          moveTargetPath = path.join(moveTargetDir, `${baseName}_${timestamp}${ext}`)
        }

        renameSync(sourcePath, moveTargetPath)

        return NextResponse.json({
          success: true,
          message: 'Moved successfully',
          newPath: moveTargetPath
        })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Operation failed: ' + (error as Error).message }, { status: 500 })
  }
}
