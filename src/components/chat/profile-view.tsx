'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { Camera, Check, Loader2, LogOut, Pencil, RefreshCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { compressImageIfNeeded } from '@/lib/compress'
import type { AuthUser } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/chat/user-avatar'

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/

interface Props {
  user: AuthUser
  onLogout: () => void
  onUserUpdated: (user: AuthUser, token?: string) => void
}

/** 我的 Tab：头像上传 + 改昵称/简介 + 退出登录 */
export function ProfileView({ user, onLogout, onUserUpdated }: Props) {
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.username)
  const [bio, setBio] = useState(user.bio ?? '')
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const handleAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = await compressImageIfNeeded(e)
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await api<{ avatarImageId: string }>('/api/avatar', { method: 'POST', body: form })
      onUserUpdated({ ...user, avatarImageId: data.avatarImageId })
      toast.success('头像已更新')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '头像上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const resetAvatar = async () => {
    if (!window.confirm('恢复为默认颜色头像？')) return
    setUploading(true)
    try {
      await api('/api/avatar', { method: 'DELETE' })
      onUserUpdated({ ...user, avatarImageId: null })
      toast.success('已恢复默认头像')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!USERNAME_RE.test(trimmed)) {
      toast.error('昵称需 2-20 位中英文/数字/下划线')
      return
    }
    setSaving(true)
    try {
      const data = await api<{ user: AuthUser; token: string | null }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ username: trimmed, bio: bio.trim() }),
      })
      onUserUpdated(data.user, data.token ?? undefined)
      toast.success('资料已保存')
      setEditing(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const confirmLogout = () => {
    if (window.confirm('确定退出登录？')) onLogout()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="text-lg font-semibold">我的</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* 头像卡片 */}
        <div className="flex flex-col items-center gap-3 px-4 py-8">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploading}
            className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="更换头像"
          >
            <UserAvatar user={user} className="h-24 w-24 text-4xl" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity hover:opacity-100">
              {uploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
            </span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleAvatar(e)} />

          {user.avatarImageId && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={uploading} onClick={() => void resetAvatar()}>
              <RefreshCcw className="mr-1 h-3 w-3" /> 恢复默认头像
            </Button>
          )}
        </div>

        {/* 资料 */}
        <div className="mx-4 rounded-2xl bg-card p-4 shadow-sm">
          {editing ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pf-name">昵称</Label>
                <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-bio">简介</Label>
                <Textarea id="pf-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={100} rows={3} placeholder="介绍一下自己吧" />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" disabled={saving} onClick={() => void save()}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} 保存
                </Button>
                <Button variant="ghost" disabled={saving} onClick={() => { setEditing(false); setName(user.username); setBio(user.bio ?? '') }}>
                  <X className="mr-1.5 h-4 w-4" /> 取消
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" className="w-full space-y-3 text-left" onClick={() => setEditing(true)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">昵称</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{user.username}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </span>
              </div>
              <div className="flex items-start justify-between gap-2 border-t pt-3">
                <span className="shrink-0 text-xs text-muted-foreground">简介</span>
                <span className="line-clamp-3 min-w-0 flex-1 break-words text-right text-sm font-medium">
                  {user.bio || <span className="text-muted-foreground/60">还没写简介</span>}
                </span>
              </div>
            </button>
          )}
        </div>

        {/* 退出登录 */}
        <div className="px-4 pt-6">
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={confirmLogout}>
            <LogOut className="mr-1.5 h-4 w-4" /> 退出登录
          </Button>
        </div>
      </div>
    </div>
  )
}
