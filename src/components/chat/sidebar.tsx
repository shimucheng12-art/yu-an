'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, LogOut, MessageCircle, Pencil, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, setToken } from '@/lib/api-client'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/chat/user-avatar'

interface Props {
  user: AuthUser
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenConversation: (conversation: ConversationItem) => void
  activeConversationId: string | null
  onUserUpdated: (user: AuthUser, token?: string) => void
  onLogout: () => void
  onOpenFriends: () => void
}

type Friend = AuthUser

/** 在线判定：lastSeen 15 秒内 */
function isOnline(lastSeen?: string | null): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 15_000
}

function fmtPreview(m: ConversationItem['lastMessage']): string {
  if (!m) return ''
  const prefix = m.senderName + '：'
  if (m.type === 'voice') return `${prefix}[语音]`
  if (m.type === 'file') return `${prefix}[文件]`
  return `${prefix}${(m.content ?? '').slice(0, 40)}`
}

/** 右侧抽屉侧边栏：个人中心（编辑昵称/简介）+ 会话列表 + 好友列表（点进私聊） */
export function Sidebar(props: Props) {
  const { user, open, onOpenChange, onOpenConversation, activeConversationId, onUserUpdated, onLogout, onOpenFriends } = props
  const [view, setView] = useState<'main' | 'profile'>('main')
  const [friends, setFriends] = useState<Friend[]>([])
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loadingC, setLoadingC] = useState(false)

  // 个人资料编辑
  const [nickname, setNickname] = useState(user.username)
  const [bio, setBio] = useState(user.bio ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const nicknameRef = useRef<HTMLInputElement | null>(null)

  const loadAll = useCallback(async () => {
    setLoadingC(true)
    try {
      const [friendsData, convData] = await Promise.all([
        api<{ friends: Friend[] }>('/api/friends'),
        api<{ conversations: ConversationItem[] }>('/api/conversations'),
      ])
      setFriends(friendsData.friends ?? [])
      setConversations(convData.conversations ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败'
      if (!/401/.test(message)) toast.error(message)
    } finally {
      setLoadingC(false)
    }
  }, [])

  // 打开时刷新；打开后每 12 秒轻刷新（在线状态/新会话）
  useEffect(() => {
    if (!open) return
    setView('main')
    setNickname(user.username)
    setBio(user.bio ?? '')
    void loadAll()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void loadAll() }, 12_000)
    return () => clearInterval(id)
  }, [open, user.username, user.bio, loadAll])

  const openConversationWith = useCallback(async (friend: Friend) => {
    try {
      const data = await api<{ conversation: ConversationItem }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ friendId: friend.id }),
      })
      onOpenConversation({ ...data.conversation, friend })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开会话失败')
    }
  }, [onOpenConversation, onOpenChange])

  const saveProfile = useCallback(async () => {
    const name = nickname.trim()
    if (!name) { toast.error('昵称不能为空'); return }
    setSavingProfile(true)
    try {
      const data = await api<{ user: AuthUser; token: string | null }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ username: name, bio: bio.trim() }),
      })
      if (data.token) setToken(data.token)
      onUserUpdated(data.user, data.token ?? undefined)
      toast.success('资料已保存 ✓')
      setView('main')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingProfile(false)
    }
  }, [nickname, bio, onUserUpdated])

  const lastMessageTime = (m: ConversationItem['lastMessage']) => {
    if (!m) return ''
    const d = new Date(m.createdAt)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    return sameDay
      ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sidebar-mask"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            aria-hidden="true"
          />
          <motion.aside
            key="sidebar-panel"
            role="dialog"
            aria-label="侧边栏"
            className="fixed inset-y-0 right-0 z-50 flex w-[86vw] max-w-sm flex-col border-l bg-background shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* 顶栏 */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <h2 className="text-base font-semibold">
                {view === 'profile' ? '个人中心' : '我的'}
              </h2>
              <button
                type="button"
                onClick={() => (view === 'profile' ? setView('main') : onOpenChange(false))}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={view === 'profile' ? '返回' : '关闭侧边栏'}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {view === 'profile' ? (
              /* —— 个人中心：编辑昵称与简介 —— */
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar user={user} className="h-14 w-14 text-lg" />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{user.username}</p>
                    {user.phone && <p className="text-xs text-muted-foreground">{user.phone.slice(0, 3)}****{user.phone.slice(-4)}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sb-nickname">昵称</Label>
                  <Input
                    id="sb-nickname"
                    ref={nicknameRef}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={20}
                    placeholder="2-20 位：中文/字母/数字/下划线/连字符"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sb-bio">个人简介</Label>
                  <Textarea
                    id="sb-bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={100}
                    rows={3}
                    placeholder="写点什么介绍自己吧（100 字以内）"
                    className="resize-none"
                  />
                  <p className="text-right text-xs text-muted-foreground">{bio.length}/100</p>
                </div>

                <Button onClick={saveProfile} disabled={savingProfile}>
                  {savingProfile ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  保存修改
                </Button>

                <div className="mt-auto pt-4">
                  <Button variant="ghost" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950" onClick={onLogout}>
                    <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    退出登录
                  </Button>
                </div>
              </div>
            ) : (
              /* —— 主视图：个人信息卡 + 会话 + 好友 —— */
              <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
                {/* 个人卡（点击进个人中心） */}
                <button
                  type="button"
                  onClick={() => setView('profile')}
                  className="flex w-full items-center gap-3 border-b px-4 py-4 text-left hover:bg-muted/50"
                >
                  <UserAvatar user={user} className="h-12 w-12" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-base font-semibold">{user.username}</span>
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {user.bio?.trim() || '点击编辑昵称和简介'}
                    </span>
                  </span>
                </button>

                {/* 会话列表 */}
                <section aria-label="私聊会话" className="px-2 py-2">
                  <div className="flex items-center gap-2 px-2 pb-1 pt-2 text-sm font-medium text-muted-foreground">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    私聊会话
                  </div>
                  {loadingC && conversations.length === 0 ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
                  ) : conversations.length === 0 ? (
                    <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">还没有私聊，从下面好友列表开始一段吧</p>
                  ) : (
                    <div>
                      {conversations.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { onOpenConversation(c); onOpenChange(false) }}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/60',
                            c.id === activeConversationId && 'bg-primary/10'
                          )}
                        >
                          <UserAvatar user={c.friend} className="h-10 w-10" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium">{c.friend.username}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">{lastMessageTime(c.lastMessage)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {c.lastMessage ? fmtPreview(c.lastMessage) : (c.friend.bio?.trim() || '开始聊天')}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {/* 好友列表 */}
                <section aria-label="好友" className="px-2 pb-4 pt-1">
                  <div className="flex items-center gap-2 px-2 pb-1 pt-2 text-sm font-medium text-muted-foreground">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    好友
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{friends.length}</span>
                  </div>
                  {friends.length === 0 ? (
                    <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">还没有好友，点下方按钮添加</p>
                  ) : (
                    <div>
                      {friends.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => void openConversationWith(f)}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/60"
                        >
                          <UserAvatar user={f} className="h-10 w-10" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{f.username}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {f.bio?.trim() || (isOnline(f.lastSeen) ? '在线' : '离线')}
                            </span>
                          </span>
                          {isOnline(f.lastSeen) && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="在线" />}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* 底部：加好友入口（个人中心视图不显示） */}
            {view === 'main' && (
              <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button variant="outline" className="w-full" onClick={() => { onOpenChange(false); onOpenFriends() }}>
                  <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  添加 / 管理好友
                </Button>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
