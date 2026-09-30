'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/chat/user-avatar'

interface Props {
  user: AuthUser
  friends: AuthUser[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (conv: ConversationItem) => void
}

/** 建群：勾选好友 → 创建群聊 */
export function GroupCreateDialog({ user, friends, open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const pickedList = useMemo(() => friends.filter((f) => picked.has(f.id)), [friends, picked])

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async () => {
    if (picked.size === 0) {
      toast.error('请至少选择一位好友')
      return
    }
    setCreating(true)
    try {
      const data = await api<{ conversation: ConversationItem }>('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), memberIds: [...picked] }),
      })
      toast.success(`群聊「${data.conversation.name}」创建成功`)
      setPicked(new Set())
      setName('')
      onOpenChange(false)
      onCreated(data.conversation)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '创建失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!creating) onOpenChange(o) }}>
      <DialogContent className="max-h-[85dvh] max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>发起群聊</DialogTitle>
          <DialogDescription>选择好友一起建群（创建后也可以再邀请）</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col">
          <div className="space-y-1.5 border-b px-4 py-3">
            <Label htmlFor="group-name">群名称（可留空自动生成）</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：摸鱼小分队" maxLength={30} />
          </div>

          <div className="max-h-[45dvh] overflow-y-auto p-2">
            {friends.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">还没有好友可选</p>
            ) : (
              friends.map((f) => {
                const on = picked.has(f.id)
                return (
                  <button
                    type="button"
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
                    aria-pressed={on}
                  >
                    <UserAvatar user={f} className="h-10 w-10" />
                    <span className="flex-1 truncate text-sm font-medium">{f.username}</span>
                    <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">
            已选 {pickedList.length} 人：{pickedList.map((f) => f.username).join('、').slice(0, 40) || '无'}
          </span>
          <Button onClick={() => void create()} disabled={creating || picked.size === 0}>
            {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}
            创建群聊
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
