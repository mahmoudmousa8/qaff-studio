'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FolderOpen, File, Upload, Download, Trash2, Edit3, Move,
  ChevronRight, FolderPlus, ArrowLeft, Home, RefreshCw, Link2, Loader2,
  Check, AlertCircle, Play, HardDrive, X, Zap
} from 'lucide-react'
import { t, getLocale, type TranslationKey } from '@/lib/i18n'

interface VideoFile {
  name: string
  path: string
  size: number
  sizeFormatted: string
  modified: string
}

interface FolderItem {
  name: string
  path: string
  videoCount: number
}

interface AllFolderItem {
  path: string
  displayPath: string
}

interface Transfer {
  id: string
  type: 'upload' | 'download'
  name: string
  loaded: number
  total: number
  progress: number // 0-100
  speedFormatted: string
  etaSec: number | null
  status: 'active' | 'complete' | 'error' | 'cancelled'
  error?: string
  xhr?: XMLHttpRequest // upload only
  downloadId?: string // download only
}

interface VideoManagerProps {
  onVideoSelect?: (path: string) => void
  onClose?: () => void
  mode?: 'manage' | 'select' // manage = full features, select = just pick a video
}

export function VideoManager({ onVideoSelect, onClose, mode = 'manage' }: VideoManagerProps) {
  const { toast } = useToast()
  const [currentFolder, setCurrentFolder] = useState('')
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [videos, setVideos] = useState<VideoFile[]>([])
  const [allFolders, setAllFolders] = useState<AllFolderItem[]>([])
  const [loading, setLoading] = useState(false)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // ═══ Transfer Manager ═══
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const transfersRef = useRef<Transfer[]>([])
  // Keep ref in sync
  useEffect(() => { transfersRef.current = transfers }, [transfers])

  const upsertTransfer = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers(prev => {
      const exists = prev.find(t => t.id === id)
      if (exists) return prev.map(t => t.id === id ? { ...t, ...patch } : t)
      return [...prev, { id, type: 'upload', name: '', loaded: 0, total: 0, progress: 0, speedFormatted: '', etaSec: null, status: 'active', ...patch }]
    })
  }, [])

  const removeTransfer = useCallback((id: string) => {
    setTransfers(prev => prev.filter(t => t.id !== id))
  }, [])

  // Dialog states
  const [renameDialog, setRenameDialog] = useState<{ item: VideoFile | FolderItem; isFolder: boolean } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [itemExtension, setItemExtension] = useState('')

  const [deleteDialog, setDeleteDialog] = useState<{ item: VideoFile | FolderItem; isFolder: boolean } | null>(null)

  const [moveDialog, setMoveDialog] = useState<{ item: VideoFile } | null>(null)
  const [moveTarget, setMoveTarget] = useState<string>('')

  const [createFolderDialog, setCreateFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [recommendedOutputDialog, setRecommendedOutputDialog] = useState(false)

  // Video preview
  const [previewVideo, setPreviewVideo] = useState<VideoFile | null>(null)

  // Storage info
  const [storageInfo, setStorageInfo] = useState<{
    used: string; free: string; total: string; usedPercent: number; warning: boolean
  } | null>(null)

  const fetchStorage = useCallback(async () => {
    try {
      const res = await fetch('/api/storage')
      const data = await res.json()
      if (data.total) {
        setStorageInfo({
          used: data.usedFormatted || data.usedFormatted,
          free: data.freeFormatted,
          total: data.totalFormatted,
          usedPercent: data.usedPercent || 0,
          warning: data.warning || false,
        })
      }
    } catch { }
  }, [])
  // Download from URL
  const [downloadDialog, setDownloadDialog] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadFilename, setDownloadFilename] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)

  // Selected items for bulk actions
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  // Fetch videos and folders
  const fetchData = useCallback(async (folder: string = '') => {
    setLoading(true)
    try {
      const res = await fetch(`/api/folders?folder=${encodeURIComponent(folder)}`)
      const data = await res.json()
      setFolders(data.folders || [])
      setVideos(data.videos || [])
      setCurrentFolder(folder)
      setSelectedFiles(new Set())
    } catch {
      toast({ title: t('error'), description: 'Failed to load files', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  // Fetch all folders (for move dropdown)
  const fetchAllFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/folders?all=true')
      const data = await res.json()
      setAllFolders(data.allFolders || [])
    } catch { }
  }, [])

  useEffect(() => {
    fetchData('')
    fetchAllFolders()
    fetchStorage()
  }, [fetchData, fetchAllFolders, fetchStorage])

  // Navigation
  const navigateToFolder = (folderName: string) => {
    const newPath = currentFolder ? `${currentFolder}/${folderName}` : folderName
    fetchData(newPath)
  }

  const navigateUp = () => {
    if (!currentFolder) return
    const parts = currentFolder.split('/')
    parts.pop()
    fetchData(parts.join('/'))
  }

  // Upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(Array.from(e.target.files))
    }
  }

  // Upload via XHR — fixes 'Unexpected end of form' for large files
  const handleUpload = (files: File[]) => {
    // Start tracking upload state
    setUploading(true)

    let completedCount = 0
    let errorCount = 0

    const checkAllDone = () => {
      completedCount++
      if (completedCount >= files.length) {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (folderInputRef.current) folderInputRef.current.value = ''
        fetchData(currentFolder)
        fetchStorage()
      }
    }

    files.forEach((file) => {
      const id = `up_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const startTime = Date.now()
      let lastLoaded = 0
      let lastTime = startTime

      upsertTransfer(id, { type: 'upload', name: file.name, total: file.size, status: 'active' })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('encodedName', encodeURIComponent(file.name))

      // If a folder was uploaded, the path is available in webkitRelativePath
      // Extract the target subfolder from the path, minus the actual filename
      const relPath = file.webkitRelativePath
      let targetFolder = currentFolder
      if (relPath && relPath.includes('/')) {
        const subfolder = relPath.substring(0, relPath.lastIndexOf('/'))
        targetFolder = targetFolder ? `${targetFolder}/${subfolder}` : subfolder
      }

      if (targetFolder) formData.append('folder', targetFolder)

      const xhr = new XMLHttpRequest()
      upsertTransfer(id, { xhr })

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        const now = Date.now()
        const dt = (now - lastTime) / 1000
        const speedBps = dt > 0 ? (e.loaded - lastLoaded) / dt : 0
        lastLoaded = e.loaded
        lastTime = now
        const remaining = speedBps > 0 ? (e.total - e.loaded) / speedBps : null
        const speedFmt = speedBps > 0
          ? speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s`
            : `${(speedBps / 1024).toFixed(0)} KB/s`
          : ''
        upsertTransfer(id, {
          loaded: e.loaded,
          total: e.total,
          progress: Math.round((e.loaded / e.total) * 100),
          speedFormatted: speedFmt,
          etaSec: remaining ? Math.round(remaining) : null,
        })
      }

      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.success) {
              upsertTransfer(id, { status: 'complete', progress: 100 })
              setTimeout(() => removeTransfer(id), 8000)
            } else {
              upsertTransfer(id, { status: 'error', error: data.error || 'Upload failed' })
            }
          } catch (err) {
            upsertTransfer(id, { status: 'error', error: 'Upload failed' })
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText)
            upsertTransfer(id, { status: 'error', error: data.error || `HTTP ${xhr.status}` })
          } catch (err) {
            upsertTransfer(id, { status: 'error', error: `HTTP ${xhr.status}` })
          }
        }
        checkAllDone()
      }

      xhr.onerror = () => {
        upsertTransfer(id, { status: 'error', error: 'Network error' })
        checkAllDone()
      }

      xhr.open('POST', '/api/upload')
      xhr.send(formData)
    })
  }

  // Video select
  const handleSelect = (filePath: string) => {
    if (onVideoSelect) {
      onVideoSelect(filePath)
    }
  }

  // Create folder
  const createFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newFolderName.trim(), currentFolder })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: t('success'), description: t('createFolder') })
        setCreateFolderDialog(false)
        setNewFolderName('')
        fetchAllFolders()
        fetchData(currentFolder)
      } else {
        toast({ title: t('error'), description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: t('error'), variant: 'destructive' })
    }
  }

  // Rename — open dialog with split name/extension
  const openRenameDialog = (item: VideoFile | FolderItem, isFolder: boolean) => {
    setRenameDialog({ item, isFolder })
    if (isFolder) {
      setNewItemName(item.name)
      setItemExtension('')
    } else {
      const ext = item.name.substring(item.name.lastIndexOf('.'))
      const nameWithoutExt = item.name.substring(0, item.name.lastIndexOf('.'))
      setNewItemName(nameWithoutExt)
      setItemExtension(ext)
    }
  }

  const renameItem = async () => {
    if (!renameDialog?.item || !newItemName.trim()) return

    // Build final name: for files, append locked extension
    const finalName = renameDialog.isFolder
      ? newItemName.trim()
      : newItemName.trim() + itemExtension

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rename',
          itemPath: renameDialog.item.path,
          newName: finalName
        })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: t('renameSuccess') })
        setRenameDialog(null)
        fetchAllFolders()
        fetchData(currentFolder)
      } else {
        toast({ title: t('renameFailed'), description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: t('renameFailed'), variant: 'destructive' })
    }
  }

  // Delete
  const deleteItem = async () => {
    if (!deleteDialog?.item) return
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', itemPath: deleteDialog.item.path })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: t('deleteSuccess') })
        setDeleteDialog(null)
        fetchAllFolders()
        fetchData(currentFolder)
      } else {
        toast({ title: t('deleteFailed'), description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: t('deleteFailed'), variant: 'destructive' })
    }
  }

  // Bulk delete
  const bulkDelete = async () => {
    for (const filePath of selectedFiles) {
      try {
        await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', itemPath: filePath })
        })
      } catch { }
    }
    toast({ title: t('deleteSuccess'), description: `${selectedFiles.size} files deleted` })
    setSelectedFiles(new Set())
    fetchData(currentFolder)
  }

  // Bulk move
  const [bulkMoveDialog, setBulkMoveDialog] = useState(false)
  const [bulkMoveTarget, setBulkMoveTarget] = useState('')

  const bulkMove = async () => {
    let movedCount = 0
    for (const filePath of selectedFiles) {
      try {
        const res = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'move',
            sourcePath: filePath,
            targetFolder: bulkMoveTarget || '__ROOT__'
          })
        })
        const data = await res.json()
        if (data.success) movedCount++
      } catch { }
    }
    toast({ title: t('moveSuccess'), description: `${movedCount} / ${selectedFiles.size} files moved` })
    setSelectedFiles(new Set())
    setBulkMoveDialog(false)
    setBulkMoveTarget('')
    fetchAllFolders()
    fetchData(currentFolder)
  }

  // Move
  const moveItem = async () => {
    if (!moveDialog?.item || moveTarget === undefined) return
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move',
          sourcePath: moveDialog.item.path,
          targetFolder: moveTarget || '__ROOT__'
        })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: t('moveSuccess') })
        setMoveDialog(null)
        setMoveTarget('')
        fetchAllFolders()
        fetchData(currentFolder)
      } else {
        toast({ title: t('moveFailed'), description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: t('moveFailed'), variant: 'destructive' })
    }
  }

  // Download from URL (Google Drive etc.)
  const startDownload = async () => {
    if (!downloadUrl.trim()) return
    setDownloadBusy(true)
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: downloadUrl.trim(),
          filename: downloadFilename.trim() || undefined,
          folder: currentFolder || undefined
        })
      })
      const data = await res.json()

      if (data.success && data.downloadId) {
        toast({ title: t('downloadStarted'), description: data.filename })
        setDownloadDialog(false)
        setDownloadUrl('')
        setDownloadFilename('')

        // Poll for completion in background
        pollDownload(data.downloadId, data.filename)
      } else {
        toast({ title: t('downloadFailed'), description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: t('downloadFailed'), variant: 'destructive' })
    } finally {
      setDownloadBusy(false)
    }
  }

  const pollDownload = (downloadId: string, filename: string) => {
    const transferId = `dl_${downloadId}`
    upsertTransfer(transferId, { type: 'download', name: filename, downloadId, status: 'active' })

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/${downloadId}`)

        // Job not found (cleaned up after 10 min) — treat as complete
        if (!res.ok) {
          clearInterval(interval)
          upsertTransfer(transferId, {
            status: 'complete', progress: 100,
            speedFormatted: '', etaSec: null,
          })
          fetchData(currentFolder)
          fetchStorage()
          setTimeout(() => removeTransfer(transferId), 8000)
          return
        }

        const job = await res.json()

        if (job.status === 'complete') {
          clearInterval(interval)
          upsertTransfer(transferId, {
            status: 'complete', progress: 100,
            speedFormatted: '', etaSec: null, loaded: job.bytesDownloaded, total: job.bytesDownloaded
          })
          fetchData(currentFolder)
          fetchStorage()
          setTimeout(() => removeTransfer(transferId), 8000)
        } else if (job.status === 'error') {
          clearInterval(interval)
          upsertTransfer(transferId, { status: 'error', error: job.error || filename })
        } else {
          // Still downloading — update progress
          upsertTransfer(transferId, {
            loaded: job.bytesDownloaded || 0,
            total: job.totalBytes || 0,
            progress: job.percent ?? 0,
            speedFormatted: job.speedFormatted || '',
            etaSec: job.etaSec ?? null,
          })
        }
      } catch {
        clearInterval(interval)
      }
    }, 2000)

    // Safety: clear after 6 hours
    setTimeout(() => clearInterval(interval), 6 * 60 * 60 * 1000)
  }

  // Format date
  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString()
    } catch { return isoString }
  }

  // Toggle file selection
  const toggleSelect = (filePath: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedFiles.size === videos.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(videos.map(v => v.path)))
    }
  }

  // Breadcrumb
  // Format ETA seconds to human-readable
  const fmtEta = (sec: number | null) => {
    if (sec === null || sec <= 0) return ''
    if (sec < 60) return `${sec}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  }

  const breadcrumbParts = currentFolder ? currentFolder.split('/') : []

  return (
    <div className="flex flex-col h-full">
      {/* Storage bar */}
      {storageInfo && (
        <div className="flex items-center gap-3 px-1 pb-2 shrink-0">
          <HardDrive className={`w-4 h-4 shrink-0 ${storageInfo.warning ? 'text-red-500' : 'text-muted-foreground'}`} />
          <div className="flex-1">
            <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
              <span>Used: <strong>{storageInfo.used}</strong> | Free: <strong>{storageInfo.free}</strong></span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${storageInfo.warning ? 'bg-red-500' : storageInfo.usedPercent > 90 ? 'bg-red-500' : storageInfo.usedPercent > 70 ? 'bg-orange-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(100, storageInfo.usedPercent)}%` }}
              />
            </div>
          </div>
          <span className={`text-xs font-bold shrink-0 ${storageInfo.warning ? 'text-red-500' : storageInfo.usedPercent > 90 ? 'text-red-500' : storageInfo.usedPercent > 70 ? 'text-orange-500' : 'text-green-500'}`}>
            {storageInfo.usedPercent}%
          </span>
        </div>
      )}

      {/* ═══ Transfer Manager Panel ═══ */}
      {transfers.length > 0 && (
        <div className="mb-2 border rounded-lg bg-muted/30 overflow-hidden shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" />
              Transfers ({transfers.filter(t => t.status === 'active').length} active)
            </span>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setTransfers([])}>
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="divide-y max-h-40 overflow-y-auto">
            {transfers.map(tr => (
              <div key={tr.id} className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg shrink-0">
                    {tr.type === 'upload' ? '📤' : '⬇️'}
                  </span>
                  <span className="text-xs font-medium truncate flex-1" dir="auto" title={tr.name}>
                    {tr.name}
                  </span>
                  {/* Speed + ETA */}
                  {tr.status === 'active' && (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {tr.speedFormatted && <>{tr.speedFormatted}</>}
                      {tr.etaSec && <> · {fmtEta(tr.etaSec)}</>}
                    </span>
                  )}
                  {/* Status badge */}
                  {tr.status === 'complete' && <span className="text-xs text-green-500 font-medium shrink-0">✓ Done</span>}
                  {tr.status === 'error' && <span className="text-xs text-red-500 font-medium shrink-0 truncate max-w-[300px]" title={tr.error}>✗ {tr.error}</span>}
                  {/* Cancel / Dismiss */}
                  <Button
                    size="icon" variant="ghost" className="h-5 w-5 shrink-0"
                    onClick={() => {
                      if (tr.status === 'active' && tr.xhr) tr.xhr.abort()
                      removeTransfer(tr.id)
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  {(tr.status === 'active' && (tr.total === 0 || !tr.total)) ? (
                    <div className="h-1.5 bg-primary rounded-full w-1/3 animate-indeterminate" />
                  ) : (
                    <div
                      className={`h-1.5 rounded-full transition-all ${tr.status === 'error' ? 'bg-red-500'
                        : tr.status === 'complete' ? 'bg-green-500'
                          : 'bg-primary'
                        }`}
                      style={{ width: `${tr.progress ?? 0}%` }}
                    />
                  )}
                </div>
                {/* Bytes info for determinate */}
                {tr.total > 0 && (
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{(tr.loaded / 1048576).toFixed(1)} MB</span>
                    <span>{tr.progress}%</span>
                    <span>{(tr.total / 1048576).toFixed(1)} MB</span>
                  </div>
                )}
                {/* Bytes downloaded for indeterminate (Google Drive) */}
                {tr.status === 'active' && (!tr.total || tr.total === 0) && (tr.loaded ?? 0) > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 text-center">
                    {(tr.loaded / 1048576).toFixed(1)} MB downloaded…
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap pb-3 border-b shrink-0">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => fetchData('')} title={t('root')}>
            <Home className="w-4 h-4" />
          </Button>
          {currentFolder && (
            <Button size="sm" variant="ghost" onClick={navigateUp} title={t('back')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-hidden" dir="auto">
          <span className="cursor-pointer hover:text-foreground" onClick={() => fetchData('')}>
            {t('root')}
          </span>
          {breadcrumbParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span
                className="cursor-pointer hover:text-foreground truncate max-w-[120px]"
                onClick={() => fetchData(breadcrumbParts.slice(0, i + 1).join('/'))}
                title={part}
              >
                {part}
              </span>
            </span>
          ))}
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <Button size="sm" variant="outline" onClick={() => setCreateFolderDialog(true)}>
          <FolderPlus className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('createFolder')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRecommendedOutputDialog(true)}>
          <AlertCircle className="w-4 h-4 mr-1 text-amber-500" />
          <span className="hidden sm:inline">{t('recommendedOutput')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDownloadDialog(true)}>
          <Link2 className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('downloadFromUrl')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadDialog ? null : fileInputRef.current?.click()} disabled={uploading} title={t('uploadVideo')}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
          <span className="hidden sm:inline">{uploading ? t('uploading') : t('uploadVideo')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadDialog ? null : folderInputRef.current?.click()} disabled={uploading} title={t('uploadFolder')}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FolderPlus className="w-4 h-4 mr-1" />}
          <span className="hidden sm:inline">{uploading ? t('uploading') : t('uploadFolder')}</span>
        </Button>

        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="video/*"
          // @ts-expect-error - webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button size="sm" variant="ghost" onClick={() => fetchData(currentFolder)}>
          <RefreshCw className="w-4 h-4" />
        </Button>

        {/* Bulk move + delete */}
        {selectedFiles.size > 0 && mode === 'manage' && (
          <>
            <Button size="sm" variant="outline" onClick={() => { setBulkMoveDialog(true); setBulkMoveTarget('') }}>
              <Move className="w-4 h-4 mr-1" />
              {t('move')} ({selectedFiles.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={bulkDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              {t('delete')} ({selectedFiles.size})
            </Button>
          </>
        )}
      </div>

      {/* File list */}
      <ScrollArea className="flex-1 mt-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Folders */}
            {folders.map((folder) => (
              <div
                key={folder.path}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors group"
                onClick={() => navigateToFolder(folder.name)}
              >
                <FolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
                <span className="flex-1 text-sm font-medium truncate" dir="auto">
                  {folder.name}
                </span>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {folder.videoCount} {t('items')}
                </Badge>
                {mode === 'manage' && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => {
                      e.stopPropagation()
                      openRenameDialog(folder, true)
                    }}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => {
                      e.stopPropagation()
                      setDeleteDialog({ item: folder, isFolder: true })
                    }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {/* Videos */}
            {videos.map((video) => (
              <div
                key={video.path}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors group"
                onDoubleClick={() => setPreviewVideo(video)}
                title="Double-click to preview"
              >
                {/* Checkbox for bulk select */}
                {mode === 'manage' && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 shrink-0 accent-primary"
                    checked={selectedFiles.has(video.path)}
                    onChange={() => toggleSelect(video.path)}
                  />
                )}

                <File className="w-5 h-5 text-blue-500 shrink-0" />

                {/* Name — click to select in select mode */}
                <div
                  className={`flex-1 min-w-0 ${mode === 'select' ? 'cursor-pointer' : ''}`}
                  onClick={() => mode === 'select' && handleSelect(video.path)}
                >
                  <div className="text-sm font-medium truncate text-left" dir="ltr" title={video.name}>
                    {video.name}
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span>{video.sizeFormatted}</span>
                    <span>{formatDate(video.modified)}</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {mode === 'select' && (
                    <Button size="sm" variant="default" className="h-7" onClick={() => handleSelect(video.path)}>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      {t('select')}
                    </Button>
                  )}
                  {mode === 'manage' && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Preview"
                        onClick={() => setPreviewVideo(video)}>
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('rename')}
                        onClick={() => openRenameDialog(video, false)}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('move')}
                        onClick={() => { setMoveDialog({ item: video }); setMoveTarget('') }}>
                        <Move className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title={t('delete')}
                        onClick={() => setDeleteDialog({ item: video, isFolder: false })}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {folders.length === 0 && videos.length === 0 && !loading && (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t('noVideosFound')}</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Select all toggle for manage mode */}
      {mode === 'manage' && videos.length > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t shrink-0 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-primary"
            checked={selectedFiles.size === videos.length && videos.length > 0}
            onChange={toggleSelectAll}
          />
          <span>{selectedFiles.size > 0 ? `${selectedFiles.size} / ${videos.length}` : `${videos.length} ${t('items')}`}</span>
        </div>
      )}

      {/* ═══ Dialogs ═══ */}

      {/* Create Folder Dialog */}
      <Dialog open={createFolderDialog} onOpenChange={setCreateFolderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createFolder')}</DialogTitle>
            <DialogDescription>{t('enterFolderName')}</DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t('folderName')}
            dir="auto"
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderDialog(false)}>{t('cancel')}</Button>
            <Button onClick={createFolder}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!renameDialog} onOpenChange={(open) => !open && setRenameDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('renameItem')}</DialogTitle>
            <DialogDescription>
              {renameDialog?.isFolder ? t('enterFolderName') : t('enterNewName')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <Input
              className="flex-1"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              dir="auto"
              onKeyDown={(e) => e.key === 'Enter' && renameItem()}
              autoFocus
            />
            {/* Extension label — read-only, shown but not editable */}
            {!renameDialog?.isFolder && itemExtension && (
              <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-1.5 rounded border shrink-0">
                {itemExtension}
              </span>
            )}
          </div>
          {!renameDialog?.isFolder && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {t('extensionLocked')}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(null)}>{t('cancel')}</Button>
            <Button onClick={renameItem}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('delete')}</DialogTitle>
            <DialogDescription>
              {t('deleteConfirm')} <strong dir="auto">{deleteDialog?.item?.name}</strong>?
              <br />
              <span className="text-xs text-destructive">{t('deleteWarning')}</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>{t('cancel')}</Button>
            <Button variant="destructive" onClick={deleteItem}>{t('delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Dialog */}
      <Dialog open={!!moveDialog} onOpenChange={(open) => !open && setMoveDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('moveToFolder')}</DialogTitle>
            <DialogDescription dir="auto">
              {moveDialog?.item?.name}
            </DialogDescription>
          </DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger>
              <SelectValue placeholder={t('selectFolder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ROOT__">{t('rootFolder')}</SelectItem>
              {allFolders.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  📁 {f.displayPath}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(null)}>{t('cancel')}</Button>
            <Button onClick={moveItem}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download from URL Dialog */}
      <Dialog open={downloadDialog} onOpenChange={setDownloadDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('downloadFromUrl')}</DialogTitle>
            <DialogDescription>{t('enterUrl')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
              dir="ltr"
            />
            <Input
              value={downloadFilename}
              onChange={(e) => setDownloadFilename(e.target.value)}
              placeholder={`${t('fileName')} (${t('cancel')} = auto)`}
              dir="auto"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadDialog(false)}>{t('cancel')}</Button>
            <Button onClick={startDownload} disabled={downloadBusy || !downloadUrl.trim()}>
              {downloadBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              {downloadBusy ? t('downloading') : t('downloadFromUrl')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ═══ Video Preview Dialog ═══ */}
      <Dialog open={!!previewVideo} onOpenChange={(open) => !open && setPreviewVideo(null)}>
        <DialogContent className="sm:max-w-4xl w-[95vw] max-h-[95vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 truncate" dir="auto">
              <Play className="w-4 h-4 shrink-0" />
              {previewVideo?.name}
            </DialogTitle>
            <DialogDescription>
              {previewVideo?.sizeFormatted} — Double-click to preview
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-0">
            {previewVideo && (
              <video
                key={previewVideo.path}
                controls
                autoPlay
                className="max-w-full max-h-[70vh] w-full"
                src={`/api/videos/stream?path=${encodeURIComponent(previewVideo.path)}`}
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setPreviewVideo(null)}>Close</Button>
            {onVideoSelect && previewVideo && (
              <Button onClick={() => { onVideoSelect(previewVideo.path); setPreviewVideo(null) }}>
                <Check className="w-4 h-4 mr-1" /> Select This Video
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Bulk Move Dialog ═══ */}
      <Dialog open={bulkMoveDialog} onOpenChange={setBulkMoveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Move className="w-4 h-4" />
              {t('moveToFolder')} — {selectedFiles.size} {t('items')}
            </DialogTitle>
            <DialogDescription>
              Choose the destination folder for the selected files.
            </DialogDescription>
          </DialogHeader>
          <Select value={bulkMoveTarget} onValueChange={setBulkMoveTarget}>
            <SelectTrigger>
              <SelectValue placeholder={t('selectFolder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ROOT__">{t('rootFolder')}</SelectItem>
              {allFolders.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  📁 {f.displayPath}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveDialog(false)}>{t('cancel')}</Button>
            <Button onClick={bulkMove} disabled={!bulkMoveTarget}>
              <Move className="w-4 h-4 mr-1" />
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Recommended Output Dialog ═══ */}
      <Dialog open={recommendedOutputDialog} onOpenChange={setRecommendedOutputDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <AlertCircle className="w-5 h-5" />
              {t('recommendedOutput')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm" dir="ltr">
            <div className="bg-muted p-4 rounded-md space-y-2">
              <p className="font-semibold text-amber-500 mb-2">🔹 Export → Format</p>
              <p><strong>H.264</strong></p>

              <div className="my-4 border-t border-border" />

              <p className="font-semibold text-amber-500 mb-2">🔹 Video</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Width: <strong>1920</strong></li>
                <li>Height: <strong>1080</strong></li>
                <li>Frame Rate: <strong>25 fps</strong></li>
                <li>Profile: <strong>High</strong></li>
                <li>Level: <strong>4.1</strong></li>
                <li>Field Order: <strong>Progressive</strong></li>
              </ul>

              <div className="my-4 border-t border-border" />

              <p className="font-semibold text-amber-500 mb-2">🔹 Bitrate</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Bitrate Encoding: <strong>CBR أو VBR</strong></li>
                <li>Target Bitrate: <strong>2000 - 2500 Kbps (2 - 2.5 Mbps)</strong></li>
                <li>Key Frame Distance: <strong>50</strong> <span className="text-muted-foreground text-xs">(25fps × 2 ثانية = 50)</span></li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecommendedOutputDialog(false)}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
