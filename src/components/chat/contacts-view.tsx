'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/chat/user-avatar'
import { GroupCreateDialog } from '@/components/chat/group-create-dialog'

type Friend = AuthUser
type RequestItem = { id: string; sender?: Friend; receiver?: Friend }

interface Props {
  user: AuthUser
  onOpenConversation: (conv: ConversationItem) => void
  onOpenAddFriend: () => void
}

/** 联系人 Tab：好友列表 + 好友请求 + 发起群聊 */
export function ContactsView({ user, onOpenConversation, onOpenAddFriend }: Props) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [incoming, setIncoming] = useState<RequestItem[]>([])
  const [outgoing, setOutgoing] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<{ friends: Friend[]; incoming: RequestItem[]; outgoing: RequestItem[] }>('/api/friends')
      setFriends(data.friends)
      setIncoming(data.incoming)
      setOutgoing(data.outgoing)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) toast.error('好友列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const action = async (key: string, body: Record<string, unknown>, okMsg: string) => {
    if (busyId) return
    setBusyId(key)
    try {
      await api('/api/friends', { method: 'POST', body: JSON.stringify(body) })
      toast.success(okMsg)
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setBusyId(null)
    }
  }

  const startDm = async (friend: Friend) => {
    try {
      const data = await api<{ conversation: ConversationItem }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ friendId: friend.id }),
      })
      onOpenConversation(data.conversation)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开会话失败')
    }
  }

  const isOnline = (t?: string | null) => (t ? Date.now() - new Date(t).getTime() < 20_000 : false)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="text-lg font-semibold">联系人</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onOpenAddFriend} aria-label="添加好友">
            <UserPlus className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setGroupOpen(true)} aria-label="发起群聊">
            <Users className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span className="text-sm">加载中…</span>
          </div>
        ) : (
          <>
            {incoming.length > 0 && (
              <section className="space-y-1">
                <h2 className="px-1 text-xs font-medium text-muted-foreground">好友请求（{incoming.length}）</h2>
                {incoming.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl bg-card px-2 py-2.5 shadow-sm">
                    <UserAvatar user={item.sender ?? { username: '?', avatarColor: '#10b981' }} className="h-10 w-10" />
                    <span className="flex-1 truncate text-sm font-medium">{item.sender?.username}</span>
                    <Button size="sm" className="h-8" disabled={!!busyId} onClick={() => void action(`a-${item.id}`, { action: 'accept', requestId: item.id }, '已添加好友')}>
                      <Check className="mr-1 h-3.5 w-3.5" /> 接受
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" disabled={!!busyId} onClick={() => void action(`r-${item.id}`, { action: 'reject', requestId: item.id }, '已拒绝')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </section>
            )}

            {outgoing.length > 0 && (
              <section className="space-y-1">
                <h2 className="px-1 text-xs font-medium text-muted-foreground">已发送（等待对方同意）</h2>
                {outgoing.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl bg-card px-2 py-2.5 shadow-sm">
                    <UserAvatar user={item.receiver ?? { username: '?', avatarColor: '#10b981' }} className="h-10 w-10" />
                    <span className="flex-1 truncate text-sm font-medium">{item.receiver?.username}</span>
                    <Button size="sm" variant="ghost" className="h-8" disabled={!!busyId} onClick={() => void action(`c-${item.id}`, { action: 'cancel', requestId: item.id }, '已撤回申请')}>
                      撤回
                    </Button>
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-1">
              <h2 className="px-1 text-xs font-medium text-muted-foreground">好友（{friends.length}）</h2>
              {friends.length === 0 ? (
                <div className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                  还没有好友，点右上角 <UserPlus className="inline h-4 w-4" /> 搜索用户名添加
                </div>
              ) : (
                friends.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl bg-card px-2 py-2.5 shadow-sm">
                    <UserAvatar user={item} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.username}</div>
                      {isOnline(item.lastSeen) && <span className="text-[11px] text-emerald-600">在线</span>}
                    </div>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => void startDm(item)} aria-label={`和 ${item.username} 聊天`}>
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={!!busyId} onClick={() => void action(`d-${item.id}`, { action: 'remove', friendId: item.id }, '已解除好友')}>
                      删除
                    </Button>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>

      <GroupCreateDialog user={user} friends={friends} open={groupOpen} onOpenChange={setGroupOpen} onCreated={onOpenConversation} />
    </div>
  )
}
