'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, Cloud, Loader2, LogOut, MessageCircle, Paperclip, Send, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, api, downloadBlob } from '@/lib/api-client'
import { compressImageIfNeeded } from '@/lib/compress'
import { dateLabel } from '@/lib/format'
import type { AuthUser, ChatMessage, OnlineUser, SystemNotice } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/chat/user-avatar'
import { MessageItem } from '@/components/chat/message-item'
import { FriendsDialog } from '@/components/chat/friends-dialog'

interface Props {
  user: AuthUser
  onLogout: () => void
}

// Vercel 等 serverless 平台请求体上限约 4.5MB，图片已在上传前客户端压缩
const MAX_UPLOAD_SIZE = 4 * 1024 * 1024
// 轮询同步间隔（毫秒）：3 秒内新消息可见，足够日常聊天
const POLL_INTERVAL = 3000

interface SyncResponse {
  messages: ChatMessage[]
  online: OnlineUser[]
  typing: { userId: string; username: string }[]
}

type ListItem =
  | { kind: 'message'; key: string; message: ChatMessage; compact: boolean; showDate: boolean; dateText: string }
  | { kind: 'notice'; key: string; notice: SystemNotice; showDate: boolean; dateText: string }

export function ChatApp({ user, onLogout }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [notices, setNotices] = useState<SystemNotice[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; at: number }>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [connected, setConnected] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [imageViewer, setImageViewer] = useState<{ message: ChatMessage; url: string } | null>(null)
  const [friendsOpen, setFriendsOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLogoutRef = useRef(onLogout)
  onLogoutRef.current = onLogout
  // 轮询游标：目前已收到的最大消息序号（只由轮询结果推进，
  // 自己发消息不推进，避免跳过他人未同步的序号）
  const lastSeqRef = useRef(0)
  // 当前是否正在输入（随轮询请求上报给服务端）
  const isTypingRef = useRef(false)
  // 上一轮在线名单（id -> username），用于生成加入/离开通知
  const prevOnlineRef = useRef<Map<string, string>>(new Map())
  const firstSyncRef = useRef(true)


  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    })
  }, [])

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
  }, [])

  /** 初始化：拉取云端历史消息 */
  useEffect(() => {
    let cancelled = false
    api<{ messages: ChatMessage[]; hasMore: boolean }>('/api/messages?limit=50')
      .then((data) => {
        if (cancelled) return
        setMessages(data.messages)
        setHasMore(data.hasMore)
        lastSeqRef.current = data.messages.length > 0 ? data.messages[data.messages.length - 1].seq : 0
        setInitialLoading(false)
        scrollToBottom('auto')
      })
      .catch((err) => {
        if (cancelled) return
        setInitialLoading(false)
        if (err instanceof ApiError && err.status === 401) {
          onLogoutRef.current()
        } else {
          toast.error(err instanceof Error ? err.message : '历史消息加载失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [scrollToBottom])

  /** 轮询同步：增量消息 + 在线状态 + 输入提示（serverless 部署方案） */
  useEffect(() => {
    let cancelled = false

    const pushNotice = (kind: 'join' | 'leave', username: string) => {
      setNotices((prev) => [
        ...prev.slice(-49),
        { id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, username, at: Date.now() },
      ])
    }

    const poll = async () => {
      try {
        const data = await api<SyncResponse>(
          `/api/sync?after=${lastSeqRef.current}&typing=${isTypingRef.current ? 1 : 0}`
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

        setOnlineUsers(data.online)

        // 在线/输入状态直接以服务端返回为准（成员无变化时保持引用稳定，避免多余渲染）
        const typingMap: Record<string, { username: string; at: number }> = {}
        for (const t of data.typing) typingMap[t.userId] = { username: t.username, at: Date.now() }
        setTypingUsers((prev) => {
          const sameKeys =
            Object.keys(prev).sort().join(',') === Object.keys(typingMap).sort().join(',')
          return sameKeys ? prev : typingMap
        })

        // 对比上一轮名单，生成加入/离开通知（首轮只记录基线不提示）
        const current = new Map(data.online.map((u) => [u.userId, u.username]))
        if (!firstSyncRef.current) {
          for (const [id, username] of prevOnlineRef.current) {
            if (!current.has(id)) pushNotice('leave', username)
          }
          for (const [id, username] of current) {
            if (!prevOnlineRef.current.has(id)) pushNotice('join', username)
          }
        }
        prevOnlineRef.current = current
        firstSyncRef.current = false
      } catch (err) {
        if (cancelled) return
        setConnected(false)
        if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      }
    }

    // 页面隐藏时暂停轮询（省流量），恢复可见后最多 3 秒内自动续上
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, POLL_INTERVAL)
    void poll()

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [appendMessage, scrollToBottom])

  /** 输入状态提示的过期清理 */
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now()
        const next: typeof prev = {}
        let changed = false
        for (const [id, info] of Object.entries(prev)) {
          // 轮询周期 3 秒 + 服务端有效期 6 秒，5 秒的清理窗口保证不闪烁
          if (now - info.at < 5000) next[id] = info
          else changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

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
      const showDate = dayKey !== prevDayKey
      const dateText = dateLabel(d)
      if (item.kind === 'message') {
        const compact = !showDate && item.message.user.id === prevUserId && item.at - prevTime < 5 * 60 * 1000
        out.push({ kind: 'message', key: item.message.id, message: item.message, compact, showDate, dateText })
        prevUserId = item.message.user.id
      } else {
        out.push({ kind: 'notice', key: item.notice.id, notice: item.notice, showDate, dateText })
        prevUserId = null
      }
      prevDayKey = dayKey
      prevTime = item.at
    }
    return out
  }, [messages, notices])

  const typingNames = useMemo(
    () => Array.from(new Set(Object.values(typingUsers).map((t) => t.username))),
    [typingUsers]
  )

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    nearBottomRef.current = nearBottom
    setShowScrollBtn(!nearBottom)
    if (nearBottom) setNewCount(0)
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    const prevTop = el?.scrollTop ?? 0
    try {
      const data = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/messages?limit=50&before=${encodeURIComponent(messages[0].createdAt)}`
      )
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        const fresh = data.messages.filter((m) => !ids.has(m.id))
        return [...fresh, ...prev]
      })
      setHasMore(data.hasMore)
      requestAnimationFrame(() => {
        const el2 = scrollRef.current
        if (el2) el2.scrollTop = el2.scrollHeight - prevHeight + prevTop
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      else toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, messages])

  const sendText = useCallback(async () => {
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const { message } = await api<{ message: ChatMessage }>('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      appendMessage(message)
      setInput('')
      nearBottomRef.current = true
      setNewCount(0)
      scrollToBottom('smooth')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
      else toast.error(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }, [appendMessage, input, scrollToBottom, sending])

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    if (value.trim()) {
      // 输入状态经下一次轮询上报给服务端（typing=1）
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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        void sendText()
      }
    },
    [sendText]
  )

  const handleFileSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      // 图片会先压缩（最长边 1600px / JPEG），大幅节省流量与数据库空间
      const file = await compressImageIfNeeded(e)
      if (!file) return
      if (file.size > MAX_UPLOAD_SIZE) {
        toast.error('文件大小不能超过 4MB（图片会自动压缩）')
        return
      }
      setUploading(file.name)
      try {
        const form = new FormData()
        form.append('file', file)
        const { message } = await api<{ message: ChatMessage }>('/api/upload', {
          method: 'POST',
          body: form,
        })
        appendMessage(message)
        toast.success('文件已发送')
        nearBottomRef.current = true
        setNewCount(0)
        scrollToBottom('smooth')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) onLogoutRef.current()
        else toast.error(err instanceof Error ? err.message : '上传失败，请重试')
      } finally {
        setUploading(null)
      }
    },
    [appendMessage, scrollToBottom]
  )

  const handleLogout = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    onLogoutRef.current()
  }, [])

  const onlineList = (
    <div className="space-y-1">
      {onlineUsers.map((u) => (
        <div key={u.userId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="relative">
            <UserAvatar user={{ username: u.username, avatarColor: u.color }} className="h-8 w-8 text-sm" />
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500"
              aria-hidden="true"
            />
          </div>
          <span className="truncate text-sm">{u.username}</span>
          {u.userId === user.id && <span className="ml-auto text-xs text-muted-foreground">我</span>}
        </div>
      ))}
      {onlineUsers.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">暂时没有在线成员</p>
      )}
    </div>
  )

  return (
    <div className="flex h-dvh flex-col text-foreground">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white" aria-hidden="true">
          <Cloud className="h-4 w-4" />
        </div>
        <h1 className="text-base font-bold tracking-tight">余安</h1>
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] sm:flex',
            connected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
          )}
          role="status"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')} aria-hidden="true" />
          {connected ? '已连接' : '连接中…'}
        </span>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFriendsOpen(true)}
            aria-label="好友"
            title="好友"
            className="rounded-full"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          </Button>

          <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

          <UserAvatar user={user} className="h-8 w-8 text-sm" />
          <span className="hidden max-w-[120px] truncate text-sm font-medium sm:block">{user.username}</span>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="退出登录" title="退出登录" className="rounded-full">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 桌面端在线成员侧栏 */}
        <aside className="chat-scroll hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20 md:flex" aria-label="在线成员">
          <div className="flex items-center gap-2 px-4 pb-2 pt-4 text-sm font-medium text-muted-foreground">
            <Users className="h-4 w-4" aria-hidden="true" />
            在线成员
            <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
              {onlineUsers.length}
            </span>
          </div>
          <div className="flex-1 px-2 pb-4">{onlineList}</div>
          <div className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            好友关系与账号数据保存在云端
            <br />
            换设备登录即可继续使用
          </div>
        </aside>

        {/* 主聊天区 */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="chat-scroll flex-1 overscroll-contain px-3 py-4 sm:px-6"
            role="log"
            aria-label="聊天消息"
            aria-live="polite"
          >
            {initialLoading ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                <p className="text-sm">正在加载云端消息…</p>
              </div>
            ) : (
              <>
                {hasMore && (
                  <div className="mb-2 flex justify-center">
                    <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="rounded-full text-xs">
                      {loadingMore ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      {loadingMore ? '加载中…' : '加载更早的消息'}
                    </Button>
                  </div>
                )}

                {items.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <MessageCircle className="h-10 w-10 opacity-30" aria-hidden="true" />
                    <p className="text-sm">还没有消息，来打个招呼吧</p>
                  </div>
                )}

                {items.map((item) =>
                  item.kind === 'notice' ? (
                    <div key={item.key}>
                      {item.showDate && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{item.dateText}</span>
                        </div>
                      )}
                      <div className="my-2 flex justify-center">
                        <span className="rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground">
                          {item.notice.kind === 'join' ? `${item.notice.username} 加入了聊天` : `${item.notice.username} 离开了聊天`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div key={item.key}>
                      {item.showDate && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{item.dateText}</span>
                        </div>
                      )}
                      <MessageItem
                        message={item.message}
                        isOwn={item.message.user.id === user.id}
                        compact={item.compact}
                        onPreviewImage={(message, url) => setImageViewer({ message, url })}
                      />
                    </div>
                  )
                )}
              </>
            )}
          </div>

          {/* 回到底部按钮 */}
          <AnimatePresence>
            {showScrollBtn && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2"
              >
                <Button
                  size="sm"
                  className="pointer-events-auto rounded-full shadow-lg"
                  onClick={() => {
                    setNewCount(0)
                    nearBottomRef.current = true
                    scrollToBottom('smooth')
                  }}
                >
                  <ArrowDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {newCount > 0 ? `${newCount} 条新消息` : '回到底部'}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 正在输入提示 */}
          <div className="flex h-6 shrink-0 items-center px-4 text-xs text-muted-foreground" aria-live="polite">
            {typingNames.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="flex gap-0.5" aria-hidden="true">
                  <i className="h-1 w-1 animate-bounce rounded-full bg-current" style={{ animationDelay: '0ms' }} />
                  <i className="h-1 w-1 animate-bounce rounded-full bg-current" style={{ animationDelay: '150ms' }} />
                  <i className="h-1 w-1 animate-bounce rounded-full bg-current" style={{ animationDelay: '300ms' }} />
                </span>
                {typingNames.join('、')} 正在输入…
              </span>
            )}
          </div>

          {/* 输入区 */}
          <footer className="shrink-0 border-t bg-background/80 backdrop-blur">
            {uploading && (
              <div className="flex items-center gap-2 px-4 pt-2.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span className="truncate">正在上传「{uploading}」…</span>
              </div>
            )}
            <div className="flex items-end gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} tabIndex={-1} aria-hidden="true" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!uploading}
                aria-label="发送文件"
                title="发送文件（图片自动压缩，单文件不超过 4MB）"
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Textarea
                rows={1}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-muted/50 py-2.5"
                aria-label="消息输入框"
                maxLength={4000}
              />
              <Button
                type="button"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
                onClick={() => void sendText()}
                disabled={!input.trim() || sending}
                aria-label="发送消息"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </footer>
        </main>
      </div>

      <FriendsDialog user={user} open={friendsOpen} onOpenChange={setFriendsOpen} />

      {/* 图片查看器 */}
      <Dialog open={!!imageViewer} onOpenChange={(open) => !open && setImageViewer(null)}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
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
