'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookHeart,
  Loader2,
  RefreshCw,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import type { AuthUser, SquareData, SquareItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/chat/user-avatar'

interface Props {
  user: AuthUser
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Friend = AuthUser & { linked?: boolean }

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
  if (!it.happenedAt) return ''
  const d = new Date(it.happenedAt)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return sameYear ? base : `${d.getFullYear()}年${base}`
}

/** 广场弹窗：我的广场 + 好友广场（碎碎念日记与小确幸联动，仅好友可见） */
export function SquareDialog({ user, open, onOpenChange }: Props) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [targetUsername, setTargetUsername] = useState<string | null>(null)
  const [square, setSquare] = useState<SquareData | null>(null)
  const [loadingSquare, setLoadingSquare] = useState(false)

  // 图片查看
  const [viewingImage, setViewingImage] = useState<string | null>(null)

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
      // 静默失败，广场列表刷新不阻塞
    }
  }, [])

  const loadSquare = useCallback(async (username: string | null, refresh = false) => {
    setLoadingSquare(true)
    try {
      const qs = username ? `?username=${encodeURIComponent(username)}` : ''
      const data = await api<SquareData>(`/api/square${qs}${refresh ? (qs ? '&refresh=1' : '?refresh=1') : ''}`)
      setSquare(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '广场加载失败')
      setSquare(null)
    } finally {
      setLoadingSquare(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setView('list')
    setSquare(null)
    setTargetUsername(null)
    void loadFriends()
    void loadSquare(user.username)
  }, [open, user.username, loadFriends, loadSquare])

  const openSquare = (username: string | null) => {
    setTargetUsername(username)
    setView('detail')
    void loadSquare(username)
  }

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
      toast.success('碎碎念账号绑定成功，广场已同步')
      setBindPhone('')
      setBindCode('')
      await loadSquare(user.username, true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '绑定失败，请重试')
    } finally {
      setBindLoading(false)
    }
  }

  const diaryCount = square?.items?.filter((i) => i.type === 'diary').length ?? 0
  const recordCount = square?.items?.filter((i) => i.type === 'record').length ?? 0

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85dvh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
          {view === 'list' ? (
            <>
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <BookHeart className="h-4 w-4 text-primary" aria-hidden="true" />
                  广场
                </DialogTitle>
                <DialogDescription className="text-xs">
                  碎碎念的日记与小确幸 · 仅好友可见
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">我的广场</p>
                  <button
                    type="button"
                    onClick={() => openSquare(null)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-3 text-left transition-colors hover:bg-accent"
                  >
                    <UserAvatar user={user} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.username}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {square ? (square.linked ? '碎碎念已同步' : '未绑定手机号') : '加载中…'}
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
                          onClick={() => openSquare(f.username)}
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
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setView('list')}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">返回</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {targetUsername ?? user.username} 的广场
                  </p>
                  {square?.linked && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {timeAgo(square.syncedAt)} · 日记 {diaryCount} · 小确幸 {recordCount}
                    </p>
                  )}
                </div>
                {square?.isSelf && square.linked && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={loadingSquare}
                    onClick={() => void loadSquare(null, true)}
                  >
                    <RefreshCw className={cn('h-4 w-4', loadingSquare && 'animate-spin')} aria-hidden="true" />
                    <span className="sr-only">刷新</span>
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {loadingSquare && !square ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : !square ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    加载失败
                  </div>
                ) : !square.linked ? (
                  square.isSelf ? (
                    <div className="space-y-4 py-6">
                      <div className="rounded-2xl border border-dashed p-5 text-center">
                        <Smartphone className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm font-medium">绑定碎碎念账号</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          绑定后，你的碎碎念日记与小确幸
                          <br />
                          会展示在广场里（仅好友可见）
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
                          {bindLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            '验证并绑定'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                      <BookHeart className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">
                        {square.username} 还没有绑定碎碎念账号
                      </p>
                    </div>
                  )
                ) : (square.items ?? []).length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <BookHeart className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">
                      广场还是空的，去碎碎念记录点什么吧
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 pb-2">
                    {(square.items ?? []).map((it) => (
                      <motion.article
                        key={it.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-border/60 bg-card/50 p-4"
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          {it.type === 'diary' ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                              日记
                            </span>
                          ) : (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950 dark:text-rose-300">
                              小确幸
                            </span>
                          )}
                          {it.mood && (
                            <span className="text-[11px] text-muted-foreground">{it.mood}</span>
                          )}
                          {it.category && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                              {it.category}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                            {itemTime(it)}
                          </span>
                        </div>
                        {it.title && <h3 className="mb-1 text-sm font-semibold">{it.title}</h3>}
                        {it.content && (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                            {it.content}
                          </p>
                        )}
                        {it.images && it.images.length > 0 && (
                          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                            {it.images.slice(0, 9).map((src, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className="aspect-square overflow-hidden rounded-lg"
                                onClick={() => setViewingImage(src)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={src}
                                  alt={`图片 ${idx + 1}`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {viewingImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setViewingImage(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
            onClick={() => setViewingImage(null)}
            aria-label="关闭"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewingImage}
            alt="图片"
            className="max-h-[85dvh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
