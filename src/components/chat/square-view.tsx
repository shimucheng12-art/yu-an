'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookHeart,
  Check,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { compressImageIfNeeded } from '@/lib/compress'
import type { AuthUser, SquareData, SquareItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/chat/user-avatar'

interface Props {
  user: AuthUser
}

type Friend = AuthUser

/** 我的管理数据：碎碎念条目（含发布标记）+ 自主帖子 */
interface MineData {
  linked: boolean
  phone: string | null
  tokenAlive: boolean
  syncedAt: string | null
  items: (SquareItem & { published: boolean })[]
  posts: SquareItem[]
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '从未同步'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚同步'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前同步`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前同步`
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日同步`
}

function itemTime(it: SquareItem): string {
  const iso = it.happenedAt ?? it.createdAt ?? null
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return sameYear ? base : `${d.getFullYear()}年${base}`
}

/** 条目卡片（广场动态 / 管理列表共用展示） */
function ItemCard({
  it,
  children,
}: {
  it: SquareItem
  children?: React.ReactNode
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/60 bg-card/50 p-4"
    >
      <div className="mb-1.5 flex items-center gap-2">
        {it.type === 'diary' ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            日记
          </span>
        ) : it.type === 'record' ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950 dark:text-rose-300">
            小确幸
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            动态
          </span>
        )}
        {it.mood && <span className="text-[11px] text-muted-foreground">{it.mood}</span>}
        {it.category && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
            {it.category}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{itemTime(it)}</span>
      </div>
      {it.title && <h3 className="mb-1 text-sm font-semibold">{it.title}</h3>}
      {it.content && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{it.content}</p>
      )}
      {it.images && it.images.length > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {it.images.slice(0, 9).map((src, idx) => (
            <button
              key={idx}
              type="button"
              className="aspect-square overflow-hidden rounded-lg"
              onClick={(e) => {
                const url = (e.currentTarget.querySelector('img') as HTMLImageElement | null)?.src
                if (url) window.open(url, '_blank')
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`图片 ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {children}
    </motion.article>
  )
}

/** 广场弹窗：我的广场（动态发布 + 碎碎念管理） + 好友广场（仅好友可见） */
export function SquareView({ user }: Props) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [view, setView] = useState<'list' | 'self' | 'friend'>('list')
  const [targetUsername, setTargetUsername] = useState<string | null>(null)
  const [square, setSquare] = useState<SquareData | null>(null)
  const [mine, setMine] = useState<MineData | null>(null)
  const [selfTab, setSelfTab] = useState<'feed' | 'manage'>('feed')
  const [loading, setLoading] = useState(false)

  // 发帖框
  const [postText, setPostText] = useState('')
  const [postImages, setPostImages] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  const postFileRef = useRef<HTMLInputElement | null>(null)

  // 绑定手机号表单
  const [bindPhone, setBindPhone] = useState('')
  const [bindCode, setBindCode] = useState('')
  const [bindCountdown, setBindCountdown] = useState(0)
  const [bindSending, setBindSending] = useState(false)
  const [bindLoading, setBindLoading] = useState(false)
  const bindTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (bindTimer.current) clearInterval(bindTimer.current)
    }
  }, [])

  useEffect(() => {
    if (bindCountdown > 0 && !bindTimer.current) {
      bindTimer.current = setInterval(() => {
        setBindCountdown((c) => {
          if (c <= 1) {
            if (bindTimer.current) {
              clearInterval(bindTimer.current)
              bindTimer.current = null
            }
            return 0
          }
          return c - 1
        })
      }, 1000)
    }
  }, [bindCountdown])

  const loadFriends = useCallback(async () => {
    try {
      const data = await api<{ friends: Friend[] }>('/api/friends')
      setFriends(data.friends ?? [])
    } catch {
      // 静默失败
    }
  }, [])

  const loadMine = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const qs = refresh ? '?mine=items&refresh=1' : '?mine=items'
      const data = await api<MineData>(`/api/square${qs}`)
      setMine(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
      setMine(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSquare = useCallback(async (username: string) => {
    setLoading(true)
    try {
      const data = await api<SquareData>(`/api/square?username=${encodeURIComponent(username)}`)
      setSquare(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '广场加载失败')
      setSquare(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setView('list')
    setSquare(null)
    setMine(null)
    setTargetUsername(null)
    setSelfTab('feed')
    setPostText('')
    setPostImages([])
    void loadFriends()
  }, [loadFriends])

  const openSelf = () => {
    setView('self')
    void loadMine()
  }

  const openFriend = (username: string) => {
    setTargetUsername(username)
    setView('friend')
    void loadSquare(username)
  }

  // —— 发布 / 取消发布碎碎念条目 ——
  const togglePublish = async (it: SquareItem & { published: boolean }) => {
    const next = !it.published
    try {
      await api('/api/square', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish', ids: [it.id], published: next }),
      })
      toast.success(next ? '已发布到广场（好友可见）' : '已取消发布')
      setMine((m) =>
        m ? { ...m, items: m.items.map((x) => (x.id === it.id ? { ...x, published: next } : x)) } : m
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  // —— 选图（发帖） ——
  const pickPostImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files).slice(0, 3 - postImages.length)
    for (const f of list) {
      try {
        const compressed = await compressImageIfNeeded(f, 1080, 0.8)
        setPostImages((arr) => (arr.length >= 3 ? arr : [...arr, compressed]))
      } catch {
        toast.error(`图片「${f.name}」处理失败`)
      }
    }
    if (postFileRef.current) postFileRef.current.value = ''
  }

  // —— 发帖 ——
  const submitPost = async () => {
    const text = postText.trim()
    if (!text && postImages.length === 0) {
      toast.error('写点什么或配张图吧')
      return
    }
    setPosting(true)
    try {
      await api('/api/square', {
        method: 'POST',
        body: JSON.stringify({ action: 'createPost', text, images: postImages }),
      })
      toast.success('已发布到广场')
      setPostText('')
      setPostImages([])
      await loadMine()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败')
    } finally {
      setPosting(false)
    }
  }

  // —— 删帖 ——
  const deletePost = async (id: string) => {
    try {
      await api('/api/square', {
        method: 'POST',
        body: JSON.stringify({ action: 'deletePost', id }),
      })
      setMine((m) => (m ? { ...m, posts: m.posts.filter((p) => p.id !== id) } : m))
      toast.success('已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  // —— 绑定 ——
  const handleBindSendCode = async () => {
    const p = bindPhone.trim()
    if (!/^1[3-9]\d{9}$/.test(p)) {
      toast.error('请输入正确的 11 位手机号')
      return
    }
    if (bindSending || bindCountdown > 0) return
    setBindSending(true)
    try {
      const res = await fetch('/api/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; retryAfterMs?: number }
      if (res.ok) {
        toast.success('验证码已发送，请查收短信')
        setBindCountdown(60)
      } else if (res.status === 429) {
        toast.error(data.error ?? '发送太频繁，请稍后再试')
        if (data.retryAfterMs) setBindCountdown(Math.max(5, Math.ceil(data.retryAfterMs / 1000)))
      } else {
        toast.error(data.error ?? '发送失败，请稍后重试')
      }
    } catch {
      toast.error('网络异常，请检查网络后重试')
    } finally {
      setBindSending(false)
    }
  }

  const handleBind = async () => {
    const p = bindPhone.trim()
    if (!/^1[3-9]\d{9}$/.test(p)) {
      toast.error('请输入正确的 11 位手机号')
      return
    }
    if (!/^\d{6}$/.test(bindCode.trim())) {
      toast.error('请输入 6 位短信验证码')
      return
    }
    setBindLoading(true)
    try {
      await api('/api/phone/login', {
        method: 'POST',
        body: JSON.stringify({ phone: p, code: bindCode.trim() }),
      })
      toast.success('碎碎念账号绑定成功')
      setBindPhone('')
      setBindCode('')
      await loadMine(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '绑定失败，请重试')
    } finally {
      setBindLoading(false)
    }
  }

  // 我的公开动态 = 帖子 + 已发布碎碎念
  const myFeed = useMemoFeed(mine)
  const friendFeed = square?.items ?? []
  const diaryCount = mine?.items.filter((i) => i.type === 'diary').length ?? 0
  const recordCount = mine?.items.filter((i) => i.type === 'record').length ?? 0

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
          {view === 'list' ? (
            <>
              <header className="shrink-0 border-b px-5 py-4">
                <h1 className="flex items-center gap-2 text-lg font-semibold">
                  <BookHeart className="h-5 w-5 text-primary" aria-hidden="true" />
                  广场
                </h1>
                <p className="text-xs text-muted-foreground">发布动态与碎碎念精选 · 仅好友可见</p>
              </header>
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">我的广场</p>
                  <button
                    type="button"
                    onClick={openSelf}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-3 text-left transition-colors hover:bg-accent"
                  >
                    <UserAvatar user={user} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.username}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {mine === null && loading ? '加载中…' : mine?.linked ? '碎碎念已同步' : '未绑定手机号'}
                      </p>
                    </div>
                    <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">好友的广场</p>
                  {friends.length === 0 ? (
                    <div className="rounded-2xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                      还没有好友，先去添加好友吧
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {friends.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => openFriend(f.username)}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-accent"
                        >
                          <UserAvatar user={f} className="h-10 w-10" />
                          <span className="flex-1 truncate text-sm font-medium">{f.username}</span>
                          <BookHeart className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : view === 'self' ? (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setView('list')}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">返回</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">我的广场</p>
                  {mine && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {mine.linked ? `${timeAgo(mine.syncedAt)} · 日记 ${diaryCount} · 小确幸 ${recordCount}` : '未绑定碎碎念'}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={loading}
                  onClick={() => void loadMine(true)}
                >
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
                  <span className="sr-only">刷新</span>
                </Button>
              </div>

              {/* Tab 切换 */}
              <div className="flex gap-1 border-b px-4 pt-2">
                {(['feed', 'manage'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelfTab(t)}
                    className={cn(
                      'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
                      selfTab === t
                        ? 'border-b-2 border-primary text-primary'
                        : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t === 'feed' ? '动态' : '管理碎碎念'}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {loading && !mine ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : !mine ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载失败</div>
                ) : selfTab === 'feed' ? (
                  <div className="space-y-3 pb-2">
                    {/* 发帖框 */}
                    <div className="rounded-2xl border border-border/60 bg-card/50 p-3">
                      <Textarea
                        value={postText}
                        onChange={(e) => setPostText(e.target.value)}
                        placeholder="记录此刻的想法…"
                        className="min-h-[70px] resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
                        maxLength={2000}
                      />
                      {postImages.length > 0 && (
                        <div className="mt-2 flex gap-2">
                          {postImages.map((src, idx) => (
                            <div key={idx} className="relative h-16 w-16 shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={`待发图片 ${idx + 1}`} className="h-full w-full rounded-lg object-cover" />
                              <button
                                type="button"
                                className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground text-background p-0.5"
                                onClick={() => setPostImages((arr) => arr.filter((_, i) => i !== idx))}
                                aria-label="移除图片"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={postImages.length >= 3}
                          onClick={() => postFileRef.current?.click()}
                        >
                          <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
                          图片 {postImages.length}/3
                        </Button>
                        <input
                          ref={postFileRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => void pickPostImages(e.target.files)}
                        />
                        <Button size="sm" disabled={posting} onClick={() => void submitPost()}>
                          {posting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1 h-4 w-4" aria-hidden="true" />}
                          发布
                        </Button>
                      </div>
                    </div>

                    {myFeed.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-8 text-center">
                        <BookHeart className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                        <p className="text-sm text-muted-foreground">
                          还没有公开动态，发一条或去「管理碎碎念」挑选发布
                        </p>
                      </div>
                    ) : (
                      myFeed.map((it) => (
                        <ItemCard key={it.id} it={it}>
                          {it.type === 'post' && (
                            <button
                              type="button"
                              onClick={() => void deletePost(it.id)}
                              className="mt-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                              删除
                            </button>
                          )}
                        </ItemCard>
                      ))
                    )}
                  </div>
                ) : !mine.linked ? (
                  <div className="space-y-4 py-6">
                    <div className="rounded-2xl border border-dashed p-5 text-center">
                      <Smartphone className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm font-medium">绑定碎碎念账号</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        绑定后可挑选碎碎念里的日记与小确幸
                        <br />
                        发布到广场（仅好友可见）
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="bindPhone">手机号</Label>
                        <Input
                          id="bindPhone"
                          type="tel"
                          inputMode="numeric"
                          value={bindPhone}
                          onChange={(e) => setBindPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                          placeholder="碎碎念注册的手机号"
                          maxLength={11}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="bindCode">短信验证码</Label>
                        <div className="flex gap-2">
                          <Input
                            id="bindCode"
                            type="text"
                            inputMode="numeric"
                            value={bindCode}
                            onChange={(e) => setBindCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="6 位验证码"
                            maxLength={6}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0"
                            disabled={bindSending || bindCountdown > 0 || !/^1[3-9]\d{9}$/.test(bindPhone)}
                            onClick={() => void handleBindSendCode()}
                          >
                            {bindSending ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : bindCountdown > 0 ? (
                              `${bindCountdown}s`
                            ) : (
                              '获取验证码'
                            )}
                          </Button>
                        </div>
                      </div>
                      <Button className="w-full" disabled={bindLoading} onClick={() => void handleBind()}>
                        {bindLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : '验证并绑定'}
                      </Button>
                    </div>
                  </div>
                ) : mine.items.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-8 text-center">
                    <BookHeart className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">
                      碎碎念里还没有日记或小确幸，先去记录吧
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 pb-2">
                    {mine.items.map((it) => (
                      <ItemCard key={it.id} it={it}>
                        <button
                          type="button"
                          onClick={() => void togglePublish(it)}
                          className={cn(
                            'mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                            it.published
                              ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground hover:bg-accent'
                          )}
                        >
                          <Check className={cn('h-3.5 w-3.5', !it.published && 'opacity-40')} aria-hidden="true" />
                          {it.published ? '已公开 · 点击取消' : '发布到广场'}
                        </button>
                      </ItemCard>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setView('list')}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">返回</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{targetUsername ?? '好友'} 的广场</p>
                  {square?.linked && (
                    <p className="truncate text-[11px] text-muted-foreground">{timeAgo(square.syncedAt)}</p>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {loading && !square ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : !square ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载失败</div>
                ) : !square.linked ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <BookHeart className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">{square.username} 还没有绑定碎碎念账号</p>
                  </div>
                ) : friendFeed.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <BookHeart className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">TA 还没有公开内容</p>
                  </div>
                ) : (
                  <div className="space-y-3 pb-2">
                    {friendFeed.map((it) => (
                      <ItemCard key={it.id} it={it} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
      </div>
    </>
  )
}

/** 我的公开动态：帖子 + 已发布碎碎念，按时间倒序 */
function useMemoFeed(mine: MineData | null): SquareItem[] {
  const posts = mine?.posts ?? []
  const published = (mine?.items ?? []).filter((i) => i.published)
  return [...posts, ...published].sort((a, b) => {
    const ta = new Date(a.happenedAt ?? a.createdAt ?? 0).getTime()
    const tb = new Date(b.happenedAt ?? b.createdAt ?? 0).getTime()
    return tb - ta
  })
}
