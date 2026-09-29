'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  BookHeart,
  Cloud,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, api, downloadBlob } from '@/lib/api-client'
import { compressImageIfNeeded } from '@/lib/compress'
import { dateLabel } from '@/lib/format'
import type { AuthUser, ChatMessage, ConversationItem, OnlineUser, SystemNotice } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/chat/user-avatar'
import { MessageItem } from '@/components/chat/message-item'
import { FriendsDialog } from '@/components/chat/friends-dialog'
import { SquareDialog } from '@/components/chat/square-dialog'
import { Sidebar } from '@/components/chat/sidebar'

interface Props {
  user: AuthUser
  onLogout: () => void
  onUserUpdated: (user: AuthUser, token?: string) => void
}

type ListItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'notice'; key: string; notice: SystemNotice }
  | { kind: 'message'; key: string; message: ChatMessage; compact: boolean }

const POLL_INTERVAL = 3_000
const HISTORY_LIMIT = 60
const MIN_VOICE_SEC = 1
const MAX_VOICE_SEC = 60

export function ChatApp({ user, onLogout, onUserUpdated }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [notices, setNotices] = useState<SystemNotice[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [imageViewer, setImageViewer] = useState<{ message: ChatMessage; url: string } | null>(null)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [squareOpen, setSquareOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)

  // 当前私聊会话（null = 大厅）
  const [activeConv, setActiveConv] = useState<ConversationItem | null>(null)

  // 录音状态
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)
  const [sendingVoice, setSendingVoice] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastSeqRef = useRef(0)
  const onLogoutRef = useRef(onLogout)
  onLogoutRef.current = onLogout

  // 录音引用
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recStartRef = useRef(0)
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recCancelledRef = useRef(false)

  const isTypingRef = useRef(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  /** 追加一条消息并滚动（自己发送的立即滚，别人的仅贴底时滚） */
  const appendMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev
        return [...prev, message]
      })
      if (message.user.id === user.id || nearBottomRef.current) {
        requestAnimationFrame(() => scrollToBottom('smooth'))
      }
    },
    [user.id, scrollToBottom]
  )

  /** 切换视图（大厅 ↔ 私聊）后拉取该视图的历史消息 */
  const loadHistory = useCallback(async (conv: ConversationItem | null) => {
    setHistoryLoading(true)
    lastSeqRef.current = 0
    setMessages([])
    setNotices([])
    try {
      const qs = conv ? `?limit=${HISTORY_LIMIT}&conversation=${encodeURIComponent(conv.id)}` : `?limit=${HISTORY_LIMIT}`
      const data = await api<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/messages${qs}`)
      setMessages(data.messages)
      if (data.messages.length > 0) lastSeqRef.current = data.messages[data.messages.length - 1].seq
      requestAnimationFrame(() => scrollToBottom('auto'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      else toast.error(err instanceof Error ? err.message : '历史消息加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [scrollToBottom])

  const openConversation = useCallback((conv: ConversationItem) => {
    setActiveConv(conv)
    setNewCount(0)
    void loadHistory(conv)
  }, [loadHistory])

  const exitConversation = useCallback(() => {
    setActiveConv(null)
    setNewCount(0)
    void loadHistory(null)
  }, [loadHistory])

  useEffect(() => {
    void loadHistory(null)
  }, [loadHistory])

  /** 轮询：大厅与私聊共用一个 sync 接口（conversation 参数区分） */
  useEffect(() => {
    let cancelled = false
    const convRef = { current: activeConv }
    const poll = async () => {
      const conv = convRef.current
      try {
        const data = await api<{
          messages: ChatMessage[]
          online: OnlineUser[]
          typing: { userId: string; username: string }[]
        }>(
          `/api/sync?after=${lastSeqRef.current}&typing=${isTypingRef.current ? 1 : 0}${
            conv ? `&conversation=${encodeURIComponent(conv.id)}` : ''
          }`
        )
        if (cancelled) return
        setConnected(true)
        if (data.messages.length > 0) {
          const lastSeq = data.messages[data.messages.length - 1].seq
          if (lastSeq > lastSeqRef.current) lastSeqRef.current = lastSeq
          for (const message of data.messages) appendMessage(message)
          if (nearBottomRef.current) {
            scrollToBottom('smooth')
          } else {
            setNewCount((c) => c + data.messages.length)
            setShowScrollBtn(true)
          }
        }
      } catch (err) {
        if (cancelled) return
        setConnected(false)
        if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      }
    }
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, POLL_INTERVAL)
    void poll()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [activeConv, appendMessage, scrollToBottom])

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  /** 合并并排序消息 + 系统通知，计算日期分隔与紧凑分组 */
  const items = useMemo<ListItem[]>(() => {
    const raw = [
      ...messages.map((m) => ({ at: new Date(m.createdAt).getTime(), kind: 'message' as const, message: m })),
      ...notices.map((n) => ({ at: n.at, kind: 'notice' as const, notice: n })),
    ].sort((a, b) => a.at - b.at)

    const out: ListItem[] = []
    let prevDayKey = ''
    let prevUserId: string | null = null
    let prevTime = 0

    for (const item of raw) {
      const d = new Date(item.at)
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (dayKey !== prevDayKey) {
        out.push({ kind: 'day', key: `day-${dayKey}`, label: dateLabel(d) })
        prevDayKey = dayKey
        prevUserId = null
        prevTime = 0
      }
      if (item.kind === 'notice') {
        out.push({ kind: 'notice', key: `notice-${item.notice.id}`, notice: item.notice })
        prevUserId = null
        continue
      }
      const compact = item.message.user.id === prevUserId && item.at - prevTime < 5 * 60_000
      out.push({ kind: 'message', key: `msg-${item.message.id}`, message: item.message, compact })
      prevUserId = item.message.user.id
      prevTime = item.at
    }
    return out
  }, [messages, notices])

  /** 发送文字（大厅或当前私聊） */
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sendingVoice) return
    setInput('')
    try {
      const data = await api<{ message: ChatMessage }>('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ content: text, conversationId: activeConv?.id ?? null }),
      })
      appendMessage(data.message)
    } catch (err) {
      setInput(text)
      if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      else toast.error(err instanceof Error ? err.message : '发送失败，请重试')
    }
  }, [input, appendMessage, activeConv, sendingVoice])

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    if (value.trim()) {
      isTypingRef.current = true
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        isTypingRef.current = false
      }, 1500)
    } else {
      isTypingRef.current = false
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  /** 上传文件（大厅或当前私聊） */
  const handleFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const displayName = file.name || '文件'
      try {
        const blob = await compressImageIfNeeded(file)
        const form = new FormData()
        form.append('file', blob, displayName)
        if (activeConv) form.append('conversationId', activeConv.id)
        const data = await api<{ message: ChatMessage }>('/api/upload', { method: 'POST', body: form })
        appendMessage(data.message)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
        else toast.error(err instanceof Error ? err.message : '文件发送失败，请重试')
      }
    },
    [appendMessage, activeConv]
  )

  // ---------- 语音录制 ----------
  const stopRecorder = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      try { rec.stop() } catch { /* noop */ }
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (recording || sendingVoice) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('当前浏览器不支持录音')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      mediaRecorderRef.current = rec
      chunksRef.current = []
      recCancelledRef.current = false
      recStartRef.current = Date.now()
      setRecordSec(0)

      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const durationSec = (Date.now() - recStartRef.current) / 1000
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        chunksRef.current = []
        mediaRecorderRef.current = null
        const cancelled = recCancelledRef.current
        setRecording(false)
        if (cancelled) return
        if (durationSec < MIN_VOICE_SEC) {
          toast.info('说话时间太短了')
          return
        }
        // 发送语音
        void (async () => {
          setSendingVoice(true)
          try {
            const form = new FormData()
            const ext = blob.type.includes('webm') ? 'webm' : 'm4a'
            form.append('file', blob, `语音-${Date.now()}.${ext}`)
            form.append('duration', String(Math.min(MAX_VOICE_SEC, Math.round(durationSec))))
            if (activeConv) form.append('conversationId', activeConv.id)
            const data = await api<{ message: ChatMessage }>('/api/upload', { method: 'POST', body: form })
            appendMessage(data.message)
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
            else toast.error(err instanceof Error ? err.message : '语音发送失败，请重试')
          } finally {
            setSendingVoice(false)
          }
        })()
      }
      rec.start(250)
      setRecording(true)
      recTimerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - recStartRef.current) / 1000)
        setRecordSec(sec)
        if (sec >= MAX_VOICE_SEC) stopRecorder()
      }, 250)
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (name === 'NotAllowedError') toast.error('麦克风权限被拒绝，请在系统设置中允许')
      else if (name === 'NotFoundError') toast.error('没有找到可用的麦克风')
      else toast.error('录音启动失败，请重试')
    }
  }, [recording, sendingVoice, activeConv, appendMessage, stopRecorder])

  const cancelRecording = useCallback(() => {
    recCancelledRef.current = true
    stopRecorder()
  }, [stopRecorder])

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== 'inactive') {
        try { rec.stop() } catch { /* noop */ }
      }
    }
  }, [])

  // ---------- 滚动位置 ----------
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    nearBottomRef.current = nearBottom
    if (nearBottom) {
      setNewCount(0)
      setShowScrollBtn(false)
    }
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行（仅桌面端生效）
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ---------- 渲染 ----------
  const friend = activeConv?.friend
  const friendOnline = friend?.lastSeen ? Date.now() - new Date(friend.lastSeen).getTime() < 20_000 : false

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur sm:px-4">
        {friend ? (
          <>
            <Button variant="ghost" size="icon" onClick={exitConversation} aria-label="返回大厅" className="rounded-full">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <UserAvatar user={friend} className="h-8 w-8 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{friend.username}</p>
              <p className={cn('text-[11px] leading-tight', friendOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                {friendOnline ? '在线' : '离线'}
              </p>
            </div>
          </>
        ) : (
          <>
            <Cloud className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="text-base font-semibold tracking-tight">余安</h1>
            <span
              className={cn(
                'ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
                connected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
              )}
              role="status"
            >
              <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle', connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')} aria-hidden="true" />
              {connected ? '已连接' : '连接中…'}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {!friend && (
            <Button variant="ghost" size="icon" onClick={() => setSquareOpen(true)} aria-label="广场" title="广场" className="rounded-full">
              <BookHeart className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {/* 右上角头像：点击划出侧边栏 */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
            className="ml-1 rounded-full ring-offset-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            <UserAvatar user={user} className="h-8 w-8 text-sm" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* 消息列表 */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="chat-scroll relative flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
            aria-live="polite"
          >
            {historyLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                {friend ? (
                  <>
                    <p className="text-sm">和 {friend.username} 的私聊还是空的</p>
                    <p className="text-xs">说点什么吧，也可以发图片、文件和语音</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm">还没有消息</p>
                    <p className="text-xs">点右上角头像打开侧边栏，找好友私聊</p>
                  </>
                )}
              </div>
            ) : (
              items.map((item) => {
                if (item.kind === 'day') {
                  return (
                    <div key={item.key} className="my-3 flex items-center gap-3" role="separator">
                      <div className="h-px flex-1 bg-border" />
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{item.label}</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )
                }
                if (item.kind === 'notice') {
                  return (
                    <div key={item.key} className="my-2 text-center text-[11px] text-muted-foreground" role="status">
                      {item.notice.kind === 'join' ? `${item.notice.username} 来了` : `${item.notice.username} 离开了`}
                    </div>
                  )
                }
                const isOwn = item.message.user.id === user.id
                return (
                  <MessageItem
                    key={item.key}
                    message={item.message}
                    isOwn={isOwn}
                    compact={item.compact}
                    onPreviewImage={(message, url) => setImageViewer({ message, url })}
                  />
                )
              })
            )}

            {newCount > 0 && (
              <div className="pointer-events-none sticky bottom-2 flex justify-center">
                <span className="pointer-events-auto rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow-md">
                  {newCount} 条新消息
                </span>
              </div>
            )}
          </div>

          {/* 回到底部 */}
          {showScrollBtn && (
            <button
              type="button"
              onClick={() => {
                setNewCount(0)
                setShowScrollBtn(false)
                scrollToBottom('smooth')
              }}
              className="absolute bottom-20 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md transition-colors hover:text-foreground"
              aria-label="滚动到底部"
            >
              {newCount > 0 ? (
                <span className="text-[11px] font-medium">{newCount}</span>
              ) : (
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          {/* 输入区 */}
          <footer className="shrink-0 border-t bg-background/80 backdrop-blur">
            <div className="flex items-end gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                aria-label="发送文件"
                className="shrink-0 rounded-full"
                disabled={recording}
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.7z,.rar" className="hidden" onChange={handleFile} aria-hidden="true" />

              <div className="relative min-w-0 flex-1">
                <Textarea
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={friend ? `和 ${friend.username} 私聊…` : '说点什么…'}
                  className="min-h-[2.5rem] max-h-32 resize-none rounded-2xl bg-muted py-2 pr-2 text-sm"
                  rows={1}
                  aria-label="消息输入框"
                />
                {recording && (
                  <div className="absolute inset-0 z-10 flex items-center justify-between rounded-2xl bg-rose-500/10 px-3 text-rose-600 dark:text-rose-400">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden="true" />
                      {recordSec}s / {MAX_VOICE_SEC}s
                    </span>
                    <button type="button" className="flex items-center gap-1 text-xs" onClick={cancelRecording}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      取消
                    </button>
                  </div>
                )}
              </div>

              {/* 语音按钮：无文字时按住说话；有文字时变发送 */}
              {input.trim() === '' ? (
                <Button
                  variant={recording ? 'default' : 'ghost'}
                  size="icon"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    void startRecording()
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault()
                    stopRecorder()
                  }}
                  onPointerLeave={() => {
                    if (recording) stopRecorder()
                  }}
                  aria-label="按住说话"
                  className={cn('shrink-0 rounded-full', recording && 'animate-pulse')}
                  disabled={sendingVoice}
                >
                  {sendingVoice ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                </Button>
              ) : (
                <Button size="icon" onClick={() => void handleSend()} aria-label="发送" className="shrink-0 rounded-full">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </footer>
        </main>
      </div>

      {/* 侧边栏（个人中心 + 好友 + 会话） */}
      <Sidebar
        user={user}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        onOpenConversation={openConversation}
        activeConversationId={activeConv?.id ?? null}
        onUserUpdated={onUserUpdated}
        onLogout={onLogout}
        onOpenFriends={() => setFriendsOpen(true)}
      />

      <FriendsDialog user={user} open={friendsOpen} onOpenChange={setFriendsOpen} />
      {!friend && <SquareDialog user={user} open={squareOpen} onOpenChange={setSquareOpen} />}

      {/* 图片查看器 */}
      <Dialog open={!!imageViewer} onOpenChange={(open) => !open && setImageViewer(null)}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          <DialogDescription className="sr-only">查看聊天中分享的图片</DialogDescription>
          {imageViewer && (
            <>
              <img src={imageViewer.url} alt={imageViewer.message.fileName ?? '图片'} className="max-h-[70vh] w-full object-contain" />
              <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-4 py-3">
                <span className="truncate text-sm text-muted-foreground">{imageViewer.message.fileName}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    void downloadBlob(`/api/files/${imageViewer.message.id}`, imageViewer.message.fileName ?? '图片')
                  }}
                >
                  下载原图
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
