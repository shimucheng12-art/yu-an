'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api, clearToken, setToken } from '@/lib/api-client'
import { destroySocket } from '@/lib/socket'
import type { AuthUser } from '@/types/chat'
import { AuthScreen } from '@/components/chat/auth-screen'
import { ChatApp } from '@/components/chat/chat-app'

type Status = 'loading' | 'guest' | 'authed'

export default function Home() {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

  // 页面加载时从持久化的 Token 恢复登录状态（无 Token 时接口返回 401，同样走 guest 分支）
  useEffect(() => {
    api<{ user: AuthUser }>('/api/me')
      .then(({ user }) => {
        setUser(user)
        setStatus('authed')
      })
      .catch(() => {
        clearToken()
        setStatus('guest')
      })
  }, [])

  const handleAuthed = (authedUser: AuthUser, token: string) => {
    setToken(token)
    setUser(authedUser)
    setStatus('authed')
  }

  const handleLogout = () => {
    clearToken()
    destroySocket()
    setUser(null)
    setStatus('guest')
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm">正在恢复登录状态…</p>
      </div>
    )
  }

  if (status === 'guest' || !user) {
    return <AuthScreen onAuthed={handleAuthed} />
  }

  return <ChatApp user={user} onLogout={handleLogout} />
}
