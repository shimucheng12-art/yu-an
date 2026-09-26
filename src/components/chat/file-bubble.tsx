'use client'

import { useEffect, useState } from 'react'
import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
} from 'lucide-react'
import { downloadBlob, fetchBlob } from '@/lib/api-client'
import { formatFileSize } from '@/lib/format'
import type { ChatMessage } from '@/types/chat'
import { cn } from '@/lib/utils'

interface Props {
  message: ChatMessage
  isOwn: boolean
  onPreviewImage: (message: ChatMessage, url: string) => void
}

function iconForType(mime: string | null) {
  if (!mime) return FileIcon
  if (mime.startsWith('image/')) return FileIcon
  if (mime.startsWith('audio/')) return FileAudio
  if (mime.startsWith('video/')) return FileVideo
  if (mime.includes('zip') || mime.includes('compress') || mime.includes('tar') || mime.includes('rar')) return FileArchive
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('word') || mime.includes('json')) return FileText
  return FileIcon
}

/** 聊天中的文件消息：图片直接预览，其他文件展示卡片 + 下载 */
export function FileBubble({ message, isOwn, onPreviewImage }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const isImage = message.isImage

  useEffect(() => {
    if (!isImage) return
    let revoked = false
    let objectUrl: string | null = null
    fetchBlob(`/api/files/${message.id}`)
      .then((blob) => {
        if (revoked) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      })
      .catch(() => setFailed(true))
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isImage, message.id])

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadBlob(`/api/files/${message.id}`, message.fileName ?? '文件')
    } catch (err) {
      console.error('download failed', err)
    } finally {
      setDownloading(false)
    }
  }

  if (isImage) {
    if (imageUrl) {
      return (
        <button
          type="button"
          onClick={() => onPreviewImage(message, imageUrl)}
          className="block cursor-zoom-in overflow-hidden rounded-xl transition-transform duration-200 hover:scale-[1.02]"
          aria-label={`查看图片 ${message.fileName ?? ''}`}
        >
          {/* blob URL 无法走 next/image，使用原生 img */}
          <img
            src={imageUrl}
            alt={message.fileName ?? '图片'}
            className="max-h-60 max-w-full rounded-xl object-cover"
          />
        </button>
      )
    }
    if (failed) {
      return <span className="text-xs opacity-70">图片加载失败，请稍后重试</span>
    }
    return <div className="h-40 w-52 animate-pulse rounded-xl bg-black/10" aria-label="图片加载中" />
  }

  const Icon = iconForType(message.fileType)

  return (
    <div className="flex min-w-[220px] max-w-[280px] items-center gap-3 py-0.5">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          isOwn ? 'bg-white/20 text-white' : 'bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'
        )}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={message.fileName ?? undefined}>
          {message.fileName}
        </p>
        <p className={cn('text-xs', isOwn ? 'text-white/75' : 'text-muted-foreground')}>
          {formatFileSize(message.fileSize)}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label={`下载文件 ${message.fileName ?? ''}`}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
          isOwn ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-muted-foreground hover:bg-emerald-600/10 hover:text-emerald-600'
        )}
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
