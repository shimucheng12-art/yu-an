'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import type { AuthUser } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Props {
  onAuthed: (user: AuthUser, token: string) => void
}

type Mode = 'login' | 'register' | 'phone'

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // 手机号登录相关状态
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [phoneAccountExists, setPhoneAccountExists] = useState<boolean | null>(null)
  const [nickname, setNickname] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // 手机号格式合法时查询是否已绑定账号（决定是否显示昵称输入框）
  useEffect(() => {
    const p = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(p)) {
      setPhoneAccountExists(null)
      return
    }
    let cancelled = false
    api<{ exists: boolean }>(`/api/phone/status?phone=${encodeURIComponent(p)}`)
      .then((d) => {
        if (!cancelled) {
          setPhoneAccountExists(d.exists)
          if (!d.exists && !nickname) setNickname(`用户${p.slice(-4)}`)
        }
      })
      .catch(() => {
        if (!cancelled) setPhoneAccountExists(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  useEffect(() => {
    if (countdown > 0 && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (timerRef.current) {
              clearInterval(timerRef.current)
              timerRef.current = null
            }
            return 0
          }
          return c - 1
        })
      }, 1000)
    }
  }, [countdown])

  const startCountdown = (seconds: number) => setCountdown(seconds)

  const handleSendCode = async () => {
    const p = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(p)) {
      toast.error('请输入正确的 11 位手机号')
      return
    }
    if (sending || countdown > 0) return
    setSending(true)
    try {
      const res = await fetch('/api/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; retryAfterMs?: number }
      if (res.ok) {
        toast.success('验证码已发送，请查收短信（5 分钟内有效）')
        startCountdown(60)
      } else if (res.status === 429) {
        toast.error(data.error ?? '发送太频繁，请稍后再试')
        if (data.retryAfterMs) startCountdown(Math.max(5, Math.ceil(data.retryAfterMs / 1000)))
      } else {
        toast.error(data.error ?? '发送失败，请稍后重试')
      }
    } catch {
      toast.error('网络异常，请检查网络后重试')
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    const name = username.trim()
    if (!name || !password) {
      toast.error('请输入用户名和密码')
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      const data = await api<{ token: string; user: AuthUser }>(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ username: name, password }),
      })
      toast.success(mode === 'register' ? `欢迎加入，${data.user.username}` : `欢迎回来，${data.user.username}`)
      onAuthed(data.user, data.token)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    const p = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(p)) {
      toast.error('请输入正确的 11 位手机号')
      return
    }
    if (!/^\d{6}$/.test(smsCode.trim())) {
      toast.error('请输入 6 位短信验证码')
      return
    }
    if (phoneAccountExists === false && nickname.trim().length < 2) {
      toast.error('请为自己取一个至少 2 个字符的昵称')
      return
    }
    setLoading(true)
    try {
      const data = await api<{ token: string; user: AuthUser; squareSynced: boolean }>(
        '/api/phone/login',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: p,
            code: smsCode.trim(),
            username: phoneAccountExists === false ? nickname.trim() : undefined,
          }),
        }
      )
      toast.success(
        data.squareSynced
          ? `欢迎，${data.user.username}（碎碎念已同步）`
          : `欢迎，${data.user.username}`
      )
      onAuthed(data.user, data.token)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30">
            <Cloud className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">余安</h1>
            <p className="mt-1 text-sm text-muted-foreground">消息 · 好友 · 广场 · 云端相伴</p>
          </div>
        </div>

        <Card className="border-border/60 shadow-xl shadow-black/5">
          <CardContent className="p-6">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
                <TabsTrigger value="phone">手机号</TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === 'phone' ? (
              <form onSubmit={handlePhoneSubmit} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">手机号（碎碎念账号）</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="11 位手机号"
                    autoComplete="tel"
                    maxLength={11}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smsCode">短信验证码</Label>
                  <div className="flex gap-2">
                    <Input
                      id="smsCode"
                      type="text"
                      inputMode="numeric"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6 位验证码"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={sending || countdown > 0 || !/^1[3-9]\d{9}$/.test(phone.trim())}
                      onClick={() => void handleSendCode()}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : countdown > 0 ? `${countdown}s` : '获取验证码'}
                    </Button>
                  </div>
                </div>

                {phoneAccountExists === false && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.2 }}
                    className="space-y-2 overflow-hidden"
                  >
                    <Label htmlFor="nickname">你的昵称（新账号）</Label>
                    <Input
                      id="nickname"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="2-20 位，好友将通过昵称找到你"
                      maxLength={20}
                      required
                    />
                  </motion.div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <>
                      <Smartphone className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      验证并登录
                    </>
                  )}
                </Button>

                <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
                  使用碎碎念（美好生活记录）的手机号
                  <br />
                  未注册将自动创建账号，日记广场自动同步
                </p>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">用户名</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="2-20 位，支持中文、字母、数字"
                    autoComplete="username"
                    maxLength={20}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 6 位"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={6}
                    maxLength={64}
                    required
                  />
                </div>

                {mode === 'register' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.2 }}
                    className="space-y-2 overflow-hidden"
                  >
                    <Label htmlFor="confirmPassword">确认密码</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="再输入一次密码"
                      autoComplete="new-password"
                      minLength={6}
                      maxLength={64}
                      required
                    />
                  </motion.div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : mode === 'login' ? '登录' : '创建账号'}
                </Button>
              </form>
            )}

            {mode !== 'phone' && (
              <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
                账号与聊天记录保存在云端服务器
                <br />
                也可以用碎碎念手机号直接登录
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
