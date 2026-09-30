'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle } from 'lucide-react'
import { api } from '@/lib/api-client'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/chat/user-avatar'

const READ_KEY = 'yuan-readat'
const POLL_MS = 5_000

/** 读取本地已读时间戳表 { conversationId: epoch ms } */
function readMap(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(READ_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function markRead(conversationId: string) {
  const m = readMap()
  m[conversationId] = Date.now()
  window.localStorage.setItem(READ_KEY, JSON.stringify(m))
}

function previewText(conv: ConversationItem): string {
  const lm = conv.lastMessage
  if (!lm) return conv.kind === 'group' ? '' : '开始聊天吧'
  if (lm.type === 'system') return (lm.content ?? '').slice(0, 60)
  const prefix = conv.kind === 'group' ? `${lm.senderName}：` : ''
  const body =
    lm.type === 'voice'
      ? '[语音]'
      : lm.type === 'file'
        ? lm.content?.startsWith('[图片]')
          ? '[图片]'
          : '[文件]'
        : (lm.content ?? '')
  return `${prefix}${body}`.slice(0, 60)
}

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

interface Props {
  user: AuthUser
  activeConversationId: string | null
  onOpenHall: () => void
  onOpenConversation: (conv: ConversationItem) => void
}

/** 消息 Tab：会话列表（大厅 + 私聊 + 群聊），微信式排布 */
export function ConversationsView({ user, activeConversationId, onOpenHall, onOpenConversation }: Props) {
  const [convs, setConvs] = useState<ConversationItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const readMapRef = useRef<Record<string, number>>({})
  const [, force] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ conversations: ConversationItem[] }>('/api/conversations')
      setConvs(data.conversations)
      readMapRef.current = readMap()
    } catch {
      /* 静默：下次轮询再试 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // 打开会话时刷新一次已读表（父组件 markRead 后触发重渲染）
  useEffect(() => {
    readMapRef.current = readMap()
    force((n) => n + 1)
  }, [activeConversationId])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="text-lg font-semibold">余安</h1>
        <span className="text-xs text-muted-foreground">{user.username}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span className="text-sm">加载中…</span>
          </div>
        ) : (
          <div>
            {/* 公共大厅（固定入口） */}
            <button
              type="button"
              onClick={onOpenHall}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent active:bg-accent',
                activeConversationId === null ? 'bg-accent' : ''
              )}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-emerald-500 text-white shadow-sm">
                <MessageCircle className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">公共大厅</div>
                <p className="truncate text-[13px] text-muted-foreground">所有在线伙伴的公共聊天室</p>
              </div>
            </button>

            {/* 私聊 + 群聊 */}
            {(convs ?? []).length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                还没有会话，去「联系人」页找好友聊聊天吧
              </div>
            ) : (
              (convs ?? []).map((conv) => {
                const lastAtMs = conv.lastAt ?? conv.lastMessage?.createdAt
                const unread =
                  conv.lastMessage &&
                  conv.lastMessage.senderName !== user.username &&
                  lastAtMs &&
                  new Date(lastAtMs).getTime() > (readMapRef.current[conv.id] ?? 0)
                return (
                  <button
                    type="button"
                    key={conv.id}
                    onClick={() => onOpenConversation(conv)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent active:bg-accent',
                      activeConversationId === conv.id ? 'bg-accent' : ''
                    )}
                  >
                    {conv.kind === 'group' ? (
                      <UserAvatar user={user} group={{ name: conv.name, avatarImageId: conv.avatarImageId }} className="h-12 w-12 text-lg" />
                    ) : (
                      <UserAvatar
                        user={{ username: conv.friend?.username ?? '?', avatarColor: conv.friend?.avatarColor ?? '#10b981', avatarImageId: conv.friend?.avatarImageId ?? conv.avatarImageId }}
                        className="h-12 w-12 text-lg"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {conv.kind === 'group' ? `${conv.name ?? '群聊'}（${conv.memberCount ?? ''}）` : conv.friend?.username}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{timeLabel(lastAtMs)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] text-muted-foreground">{previewText(conv)}</p>
                        {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label="有新消息" /> : null}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
