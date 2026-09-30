'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, Check, Loader2, Pencil, UserPlus, UserX, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { compressImageIfNeeded } from '@/lib/compress'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/chat/user-avatar'

interface MemberRow {
  id: string
  username: string
  avatarColor: string
  avatarImageId: string | null
  role: string
  lastSeen: string | null
}

interface Props {
  user: AuthUser
  conversation: ConversationItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 群信息变化（改名/换头像/人数变化） */
  onUpdated: (patch: Partial<ConversationItem>) => void
  /** 群已不存在（解散或被移出） */
  onClosed: () => void
}

/** 群资料：成员列表、群头像上传、改群名、邀请好友、踢人、退群/解散 */
export function GroupInfoDialog({ user, conversation, open, onOpenChange, onUpdated, onClosed }: Props) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [inviteMode, setInviteMode] = useState(false)
  const [inviteIds, setInviteIds] = useState<Set<string>>(new Set())
  const [friends, setFriends] = useState<AuthUser[]>([])
  const [busy, setBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ group: { name: string | null; avatarImageId: string | null; createdBy: string }; members: MemberRow[] }>(
        `/api/groups/${conversation.id}`
      )
      setMembers(data.members)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast('该群聊已不存在')
        onClosed()
      }
    } finally {
      setLoading(false)
    }
  }, [conversation.id, onClosed])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!inviteMode) return
    void api<{ friends: AuthUser[] }>('/api/friends')
      .then((d) => {
        const inGroup = new Set(members.map((m) => m.id))
        setFriends(d.friends.filter((f) => !inGroup.has(f.id)))
      })
      .catch(() => setFriends([]))
  }, [inviteMode, members])

  const myRole = members.find((m) => m.id === user.id)?.role ?? 'member'
  const isOwner = myRole === 'owner'

  const handleAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = await compressImageIfNeeded(e)
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('groupId', conversation.id)
      const data = await api<{ avatarImageId: string }>('/api/avatar', { method: 'POST', body: form })
      onUpdated({ avatarImageId: data.avatarImageId })
      toast.success('群头像已更新')
      void load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '头像上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const saveName = async () => {
    const name = nameInput.trim()
    if (!name) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      await api(`/api/groups/${conversation.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      onUpdated({ name })
      toast.success('群名已更新')
      setRenaming(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '修改失败')
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    if (inviteIds.size === 0) {
      toast.error('请选择要邀请的好友')
      return
    }
    setBusy(true)
    try {
      await api(`/api/groups/${conversation.id}/members`, { method: 'POST', body: JSON.stringify({ userIds: [...inviteIds] }) })
      toast.success('邀请成功')
      setInviteIds(new Set())
      setInviteMode(false)
      onUpdated({ memberCount: (conversation.memberCount ?? 0) + inviteIds.size })
      void load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '邀请失败')
    } finally {
      setBusy(false)
    }
  }

  const kick = async (m: MemberRow) => {
    if (!window.confirm(`确定将「${m.username}」移出群聊？`)) return
    setBusy(true)
    try {
      await api(`/api/groups/${conversation.id}/members`, { method: 'POST', body: JSON.stringify({ removeUserId: m.id }) })
      toast.success(`已将 ${m.username} 移出群聊`)
      onUpdated({ memberCount: Math.max(1, (conversation.memberCount ?? 1) - 1) })
      void load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (!window.confirm(isOwner ? '确定解散这个群聊？解散后聊天记录将删除，不可恢复。' : '确定退出这个群聊？')) return
    setBusy(true)
    try {
      await api(`/api/groups/${conversation.id}/members`, { method: 'POST', body: JSON.stringify({ leave: true }) })
      toast.success(isOwner ? '群聊已解散' : '已退出群聊')
      onOpenChange(false)
      onClosed()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const isOnline = (t: string | null) => (t ? Date.now() - new Date(t).getTime() < 20_000 : false)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-h-[85dvh] max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>群聊信息</DialogTitle>
          <DialogDescription>{conversation.name ?? '群聊'} · {members.length} 位成员</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60dvh] overflow-y-auto">
          {/* 群头像 + 群名 */}
          <div className="flex items-center gap-4 border-b px-4 py-4">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploading}
              className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="更换群头像"
            >
              <UserAvatar user={user} group={{ name: conversation.name, avatarImageId: conversation.avatarImageId }} className="h-16 w-16 text-2xl" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity hover:opacity-100">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              </span>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleAvatar(e)} />

            <div className="min-w-0 flex-1">
              {renaming ? (
                <div className="flex items-center gap-2">
                  <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={30} autoFocus />
                  <Button size="icon" className="h-8 w-8 shrink-0" disabled={busy} onClick={() => void saveName()} aria-label="保存群名">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setRenaming(false)} aria-label="取消">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setNameInput(conversation.name ?? ''); setRenaming(true) }}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <span className="truncate text-base font-semibold">{conversation.name ?? '群聊'}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">点头像可更换群头像</p>
            </div>
          </div>

          {/* 成员 */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : !inviteMode ? (
            <div className="p-2">
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-xs font-medium text-muted-foreground">群成员（{members.length}）</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => setInviteMode(true)}>
                  <UserPlus className="mr-1 h-3.5 w-3.5" /> 邀请
                </Button>
              </div>
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <UserAvatar user={m} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {m.username}
                      {m.id === user.id && <span className="ml-1 text-xs text-muted-foreground">（我）</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {m.role === 'owner' && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">群主</span>}
                      {isOnline(m.lastSeen) && <span className="text-emerald-600">在线</span>}
                    </div>
                  </div>
                  {isOwner && m.id !== user.id && (
                    <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={busy} onClick={() => void kick(m)} aria-label={`移出 ${m.username}`}>
                      <UserX className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-2">
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-xs font-medium text-muted-foreground">选择要邀请的好友</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setInviteMode(false); setInviteIds(new Set()) }}>
                  <X className="mr-1 h-3.5 w-3.5" /> 取消
                </Button>
              </div>
              {friends.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">没有可邀请的好友了</p>
              ) : (
                friends.map((f) => {
                  const on = inviteIds.has(f.id)
                  return (
                    <button
                      type="button"
                      key={f.id}
                      onClick={() => setInviteIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
                      aria-pressed={on}
                    >
                      <UserAvatar user={f} className="h-10 w-10" />
                      <span className="flex-1 truncate text-sm font-medium">{f.username}</span>
                      <span className={'flex h-5 w-5 items-center justify-center rounded-full border ' + (on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-4 py-3">
          {inviteMode ? (
            <Button className="w-full" disabled={busy || inviteIds.size === 0} onClick={() => void invite()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
              邀请 {inviteIds.size > 0 ? `（${inviteIds.size}）` : ''}
            </Button>
          ) : (
            <Button variant={isOwner ? 'destructive' : 'outline'} className="w-full" disabled={busy} onClick={() => void leave()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}
              {isOwner ? '解散群聊' : '退出群聊'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
