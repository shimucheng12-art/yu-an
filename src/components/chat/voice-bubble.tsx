'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { fetchBlob } from '@/lib/api-client'
import type { ChatMessage } from '@/types/chat'
import { cn } from '@/lib/utils'

interface Props {
  message: ChatMessage
  isOwn: boolean
}

/** 语音消息气泡：点按播放，显示时长与伪波形动画 */
export function VoiceBubble({ message, isOwn }: Props) {
  const durationSec = Math.max(1, Math.round(Number(message.content ?? 0)) || 1)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      // 组件卸载：停播放并释放 blob URL
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const toggle = async () => {
    if (playing) {
      audioRef.current?.pause()
      return
    }
    try {
      if (!audioRef.current) {
        setLoading(true)
        const blob = await fetchBlob(`/api/files/${message.id}`)
        urlRef.current = URL.createObjectURL(blob)
        setLoading(false)
        const audio = new Audio(urlRef.current)
        audio.addEventListener('ended', () => {
          setPlaying(false)
          setProgress(0)
        })
        audio.addEventListener('timeupdate', () => {
          if (audio.duration > 0) setProgress(audio.currentTime / audio.duration)
        })
        audioRef.current = audio
      }
      setPlaying(true)
      await audioRef.current.play()
    } catch {
      setLoading(false)
      setPlaying(false)
    }
  }

  const bars = Math.min(18, 6 + durationSec)

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={playing ? '暂停语音' : '播放语音'}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
          isOwn
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-primary/10 text-primary hover:bg-primary/20'
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <div className="flex h-5 items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: bars }).map((_, i) => {
          const active = playing && progress * bars >= i
          const h = 4 + ((i * 7) % 11)
          return (
            <span
              key={i}
              className={cn(
                'w-[3px] rounded-full transition-colors',
                active ? 'bg-current' : isOwn ? 'bg-white/40' : 'bg-muted-foreground/40'
              )}
              style={{ height: `${h}px` }}
            />
          )
        })}
      </div>

      <span className={cn('shrink-0 text-xs tabular-nums', isOwn ? 'text-white/85' : 'text-muted-foreground')}>
        {durationSec}&quot;
      </span>
    </div>
  )
}
