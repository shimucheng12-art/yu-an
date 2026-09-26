'use client'

import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Loader2 } from 'lucide-react'
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

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

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
      const data = await api<{ token: string; user: AuthUser }>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ username: name, password }),
      })
      toast.success(mode === 'login' ? `欢迎回来，${data.user.username}` : `欢迎加入，${data.user.username}`)
      onAuthed(data.user, data.token)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试')
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
            <p className="mt-1 text-sm text-muted-foreground">消息 · 好友 · 云端相伴</p>
          </div>
        </div>

        <Card className="border-border/60 shadow-xl shadow-black/5">
          <CardContent className="p-6">
            <Tabs value={mode} onValueChange={(v) => setMode(v === 'register' ? 'register' : 'login')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>
            </Tabs>

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

            <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
              账号与聊天记录保存在云端服务器
              <br />
              换设备登录同一账号即可继续
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
