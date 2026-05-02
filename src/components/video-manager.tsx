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
  Check, AlertCircle, Play, HardDrive, X, Zap, Search
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
  sizeFormatted?: string
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
  status: 'active' | 'processing' | 'complete' | 'error' | 'cancelled'
  error?: string
  jobId?: string // for processing state
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

  // Poll for processing status AND downloads
  useEffect(() => {
    const processingTransfers = transfers.filter(t => t.status === 'processing' && t.jobId)
    const activeDownloads = transfers.filter(t => t.status === 'active' && t.downloadId && t.type === 'download')
    
    if (processingTransfers.length === 0 && activeDownloads.length === 0) return

    const interval = setInterval(() => {
      // Poll transcodes
      processingTransfers.forEach(async (tr) => {
        try {
          const res = await fetch(`/api/transcode/status?jobId=${tr.jobId}`)
          if (!res.ok) return
          const data = await res.json()
          if (data.state === 'done') {
            upsertTransfer(tr.id, { status: 'complete', progress: 100 })
            setTimeout(() => removeTransfer(tr.id), 8000)
            // Use fetchData safely here since it might be stale, but loadVideos isn't in scope
            // We'll rely on the manual refresh or next auto-fetch for the list
          } else if (data.state === 'error') {
            upsertTransfer(tr.id, { status: 'error', error: data.error || 'Transcode failed' })
          } else if (data.state === 'processing') {
            upsertTransfer(tr.id, { progress: data.progress })
          }
        } catch (e) { }
      })

      // Poll downloads
      activeDownloads.forEach(async (dl) => {
        try {
          const res = await fetch(`/api/download/${dl.downloadId}`)
          if (!res.ok) {
            upsertTransfer(dl.id, { status: 'complete', progress: 100, speedFormatted: '', etaSec: null })
            setTimeout(() => removeTransfer(dl.id), 8000)
            return
          }
          const data = await res.json()
          upsertTransfer(dl.id, {
            status: data.status === 'downloading' ? 'active' : data.status,
            progress: data.percent || 0,
            speedFormatted: data.speedFormatted || '',
            etaSec: data.etaSec,
            loaded: data.bytesDownloaded,
            total: data.totalBytes,
            error: data.error
          })
          if (data.status === 'complete' || data.status === 'error') {
            setTimeout(() => removeTransfer(dl.id), 8000)
          }
        } catch { }
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [transfers, upsertTransfer, removeTransfer])

  // Dialog states
  const [renameDialog, setRenameDialog] = useState<{ item: VideoFile | FolderItem; isFolder: boolean } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [itemExtension, setItemExtension] = useState('')

  const [deleteDialog, setDeleteDialog] = useState<{ item: VideoFile | FolderItem; isFolder: boolean } | null>(null)

  const [moveDialog, setMoveDialog] = useState<{ item: VideoFile | FolderItem } | null>(null)
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

  // Search filter
  const [searchQuery, setSearchQuery] = useState('')

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

  const fetchActiveJobs = useCallback(async (folder: string) => {
    try {
      // Fetch Transcodes
      const resT = await fetch(`/api/transcode/list?folder=${encodeURIComponent(folder)}`)
      if (resT.ok) {
        const dataT = await resT.json()
        if (dataT.success && Array.isArray(dataT.jobs)) {
          dataT.jobs.forEach((job: any) => {
            upsertTransfer(job.id, {
              type: 'upload', 
              name: job.originalFilename || 'معالجة فيديو',
              status: job.state === 'done' ? 'complete' : (job.state === 'error' ? 'error' : 'processing'),
              progress: job.progress,
              jobId: job.id,
              error: job.error
            })
          })
        }
      }

      // Fetch Downloads
      const resD = await fetch('/api/download')
      if (resD.ok) {
        const dataD = await resD.json()
        if (dataD.downloads && Array.isArray(dataD.downloads)) {
          dataD.downloads.forEach((dl: any) => {
            // Show all downloads globally regardless of folder
            upsertTransfer(dl.id, {
              type: 'download',
              name: dl.filename || 'تحميل رابط',
              status: dl.status === 'downloading' ? 'active' : dl.status,
              progress: dl.percent || 0,
              downloadId: dl.id,
              error: dl.error,
              speedFormatted: dl.speedFormatted || '',
              etaSec: dl.etaSec,
              loaded: dl.bytesDownloaded,
              total: dl.totalBytes
            })
          })
        }
      }
    } catch { }
  }, [upsertTransfer])

  useEffect(() => {
    fetchData('')
    fetchActiveJobs('')
    fetchAllFolders()
    fetchStorage()
  }, [fetchData, fetchAllFolders, fetchStorage, fetchActiveJobs])

  // Navigation
  const navigateToFolder = (folderName: string) => {
    setSearchQuery('')
    const newPath = currentFolder ? `${currentFolder}/${folderName}` : folderName
    fetchData(newPath)
    fetchActiveJobs(newPath)
  }

  const navigateUp = () => {
    if (!currentFolder) return
    setSearchQuery('')
    const parts = currentFolder.split('/')
    parts.pop()
    const newPath = parts.join('/')
    fetchData(newPath)
    fetchActiveJobs(newPath)
  }

  // Backspace navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable ||
        e.defaultPrevented
      ) {
        return
      }

      if (e.key === 'Backspace' && currentFolder) {
        e.preventDefault()
        setSearchQuery('')
        const parts = currentFolder.split('/')
        parts.pop()
        const newPath = parts.join('/')
        fetchData(newPath)
        fetchActiveJobs(newPath)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentFolder, fetchData])

  // Upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(Array.from(e.target.files))
    }
  }

  // Upload via XHR — sequential queue per client (one file at a time)
  const handleUpload = (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)

    // Build transfer entries immediately so user sees all files in queue
    const fileEntries: { id: string; file: File; targetFolder: string }[] = files.map((file) => {
      const id = `up_${Date.now()}_${Math.random().toString(36).substring(7)}`

      const relPath = file.webkitRelativePath
      let targetFolder = currentFolder
      if (relPath && relPath.includes('/')) {
        const subfolder = relPath.substring(0, relPath.lastIndexOf('/'))
        targetFolder = targetFolder ? `${targetFolder}/${subfolder}` : subfolder
      }

      // Show all files in the queue immediately — first is 'active', rest are 'queued'
      upsertTransfer(id, {
        type: 'upload',
        name: file.name,
        total: file.size,
        status: 'active',
      })

      return { id, file, targetFolder }
    })

    // Sequential upload: process one file at a time
    const uploadNext = async (index: number) => {
      if (index >= fileEntries.length) {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (folderInputRef.current) folderInputRef.current.value = ''
        fetchData(currentFolder)
        fetchStorage()
        return
      }

      const { id, file, targetFolder } = fileEntries[index]
      let lastLoaded = 0
      let lastTime = Date.now()

      // Mark current as active (in case it was shown as queued)
      upsertTransfer(id, { status: 'active', loaded: 0, progress: 0 })

      await new Promise<void>((resolve) => {
        const formData = new FormData()
        formData.append('encodedName', encodeURIComponent(file.name))
        if (targetFolder) formData.append('folder', targetFolder)
        formData.append('file', file)

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
              if (data.processing) {
                upsertTransfer(id, { status: 'processing', progress: 0, jobId: data.jobId })
              } else if (data.success) {
                upsertTransfer(id, { status: 'complete', progress: 100 })
                setTimeout(() => removeTransfer(id), 8000)
              } else {
                upsertTransfer(id, { status: 'error', error: data.error || 'Upload failed' })
              }
            } catch {
              upsertTransfer(id, { status: 'error', error: 'Upload failed' })
            }
          } else {
            try {
              const data = JSON.parse(xhr.responseText)
              upsertTransfer(id, { status: 'error', error: data.error || `HTTP ${xhr.status}` })
            } catch {
              upsertTransfer(id, { status: 'error', error: `HTTP ${xhr.status}` })
            }
          }
          resolve()
        }

        xhr.onerror = () => {
          upsertTransfer(id, { status: 'error', error: 'Network error' })
          resolve()
        }

        xhr.onabort = () => {
          upsertTransfer(id, { status: 'cancelled' })
          resolve()
        }

        xhr.open('POST', '/api/upload')
        xhr.send(formData)
      })

      // Move to next file in queue
      uploadNext(index + 1)
    }

    uploadNext(0)
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
    upsertTransfer(downloadId, { type: 'download', name: filename, downloadId, status: 'active' })
  }

  // Format date in 24-hour style to avoid RTL/LTR flipping issues with Arabic AM/PM
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString)
      const yr = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const da = String(d.getDate()).padStart(2, '0')
      const hr = String(d.getHours()).padStart(2, '0')
      const mn = String(d.getMinutes()).padStart(2, '0')
      const sc = String(d.getSeconds()).padStart(2, '0')
      return `${yr}/${mo}/${da} ${hr}:${mn}:${sc}`
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
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
                    {tr.status === 'processing' ? '⚙️' : tr.type === 'upload' ? '📤' : '⬇️'}
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
                  {tr.status === 'processing' && <span className="text-xs text-orange-500 font-medium shrink-0 animate-pulse">جاري التحويل... {tr.progress}%</span>}
                  {tr.status === 'complete' && <span className="text-xs text-green-500 font-medium shrink-0">✓ Done</span>}
                  {tr.status === 'error' && <span className="text-xs text-red-500 font-medium shrink-0 truncate max-w-[300px]" title={tr.error}>✗ {tr.error}</span>}
                  {/* Cancel / Dismiss */}
                  <Button
                    size="icon" variant="ghost" className="h-5 w-5 shrink-0"
                    onClick={() => {
                      if (tr.status === 'active' && tr.xhr) tr.xhr.abort()
                      if (tr.status === 'processing' && tr.jobId) {
                        fetch(`/api/transcode/status?jobId=${tr.jobId}`, { method: 'DELETE' }).catch(console.error)
                      }
                      removeTransfer(tr.id)
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  {(tr.status === 'active' && (tr.total <= 0 || !tr.total)) ? (
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
                {tr.status === 'active' && (!tr.total || tr.total <= 0) && (tr.loaded ?? 0) > 0 && (
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
          <Button size="sm" variant="ghost" onClick={() => { setSearchQuery(''); fetchData('') }} title={t('root')}>
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
          <span className="cursor-pointer hover:text-foreground" onClick={() => { setSearchQuery(''); fetchData('') }}>
            {t('root')}
          </span>
          {breadcrumbParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span
                className="cursor-pointer hover:text-foreground truncate max-w-[120px]"
                onClick={() => { setSearchQuery(''); fetchData(breadcrumbParts.slice(0, i + 1).join('/')) }}
                title={part}
              >
                {part}
              </span>
            </span>
          ))}
        </div>

        <div className="flex-1" />

        <div className="relative shrink-0 hidden sm:block">
          <Search className="absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground" />
          <Input 
             type="text" 
             placeholder={getLocale() === 'en' ? 'Search files...' : 'بحث في الملفات...'} 
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
             className="h-8 w-[140px] sm:w-[180px] pl-8 text-xs bg-background"
             dir="auto"
          />
        </div>

        {/* Actions */}
        <Button size="sm" variant="outline" onClick={() => setCreateFolderDialog(true)}>
          <FolderPlus className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('createFolder')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRecommendedOutputDialog(true)}>
          <AlertCircle className="w-4 h-4 mr-1 text-amber-500" />
          <span className="hidden sm:inline">{getLocale() === 'en' ? 'Compatible Settings' : 'الإعدادات المتوافقة'}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDownloadDialog(true)}>
          <Link2 className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('downloadFromUrl')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadDialog ? null : fileInputRef.current?.click()} title={t('uploadVideo')}>
          <Upload className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('uploadVideo')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadDialog ? null : folderInputRef.current?.click()} title={t('uploadFolder')}>
          <FolderPlus className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">{t('uploadFolder')}</span>
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
        <Button size="sm" variant="ghost" onClick={() => { setSearchQuery(''); fetchData(currentFolder) }}>
          <RefreshCw className="w-4 h-4" />
        </Button>

        {/* Bulk tools */}
        {selectedFiles.size > 0 && mode === 'manage' && (
          <>
            <a href={`/api/videos/zip?paths=${Array.from(selectedFiles).map(encodeURIComponent).join(',')}&name=${encodeURIComponent('download.zip')}`} download="download.zip" target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="text-green-600 border-green-600/30 hover:bg-green-500/10">
                <Download className="w-4 h-4 mr-1" />
                {getLocale() === 'en' ? 'Download All' : 'تحميل الكل'} ({selectedFiles.size})
              </Button>
            </a>
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
      <ScrollArea className="flex-1 mt-2 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Folders */}
            {folders.filter(f => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase())).map((folder) => (
              <div
                key={folder.path}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors group"
                onClick={() => navigateToFolder(folder.name)}
              >
                <FolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
                <span className="flex-1 text-sm font-medium truncate" dir="auto">
                  {folder.name}
                </span>
                
                <span className="text-xs text-muted-foreground shrink-0 mx-1">
                  {folder.sizeFormatted}
                </span>

                <Badge variant="secondary" className="text-xs shrink-0">
                  {folder.videoCount} {t('items')}
                </Badge>
                {mode === 'manage' && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <a href={`/api/videos/zip?paths=${encodeURIComponent(folder.path)}&name=${encodeURIComponent(folder.name + '.zip')}`} onClick={e => e.stopPropagation()} download={`${folder.name}.zip`} target="_blank" rel="noopener noreferrer">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" title={getLocale() === 'ar' ? 'تحميل' : 'Download'}>
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => {
                      e.stopPropagation()
                      setMoveDialog({ item: folder })
                    }} title={t('move')}>
                      <Move className="w-3.5 h-3.5" />
                    </Button>
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
            {videos.filter(v => !searchQuery || v.name.toLowerCase().includes(searchQuery.toLowerCase())).map((video) => (
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
                      <a href={`/api/videos/stream?path=${encodeURIComponent(video.path)}&download=1`} download={video.name} target="_blank" rel="noopener noreferrer">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" title={getLocale() === 'ar' ? 'تحميل مباشر' : 'Direct Download'}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </a>
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

      {/* ═══ Compatible Settings Dialog ═══ */}
      <Dialog open={recommendedOutputDialog} onOpenChange={setRecommendedOutputDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <AlertCircle className="w-5 h-5" />
              {getLocale() === 'en' ? 'Compatible Settings' : 'الإعدادات المتوافقة'}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 text-sm dir-ltr">
              <div className="bg-muted p-4 rounded-md space-y-3 font-mono">
                
                <div>
                  <p className="font-semibold text-amber-500 mb-1">🎥 Video</p>
                  <div className="pl-4 space-y-0.5 text-[13px]">
                    <div>Codec: H.264 only</div>
                    <div>FPS: 24 / 25 / 30</div>
                    <div>Frame Type: CFR only (no VFR)</div>
                    <div>Key Frame Distance: 60</div>
                    <div>Keyframe : 2s (max 4s)</div>
                  </div>
                </div>

                <div className="border-t border-border" />

                <div>
                  <p className="font-semibold text-amber-500 mb-1">🔊 Audio</p>
                  <div className="pl-4 space-y-0.5 text-[13px]">
                    <div>Codec: AAC only</div>
                    <div>Channels: Stereo (2.0)</div>
                    <div>Sample Rate: 44.1 kHz / 48 kHz</div>
                  </div>
                </div>

                <div className="border-t border-border" />

                <div>
                  <p className="font-semibold text-amber-500 mb-1">📡 Bitrate</p>
                  <div className="pl-4 space-y-0.5 text-[13px]">
                    <div>Mode: CBR only (no VBR)</div>
                    <div>Recommended Bitrate : 1500–2500 Kbps</div>
                  </div>
                </div>

              </div>
            </div>
          </ScrollArea>
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
