"use client"

import { useEffect, useState } from "react"
import { Check, Loader2, Search, UserPlus, Users, X } from "lucide-react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { UserAvatar } from "@/components/chat/user-avatar"
import type { AuthUser } from "@/types/chat"

type Friend = AuthUser
type RequestItem = {
  id: string
  sender?: Friend
  receiver?: Friend
}

interface Props {
  user: AuthUser
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FriendsDialog({ user, open, onOpenChange }: Props) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [incoming, setIncoming] = useState<RequestItem[]>([])
  const [outgoing, setOutgoing] = useState<RequestItem[]>([])
  const [results, setResults] = useState<Friend[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await api<{ friends: Friend[]; incomingRequests: RequestItem[]; outgoingRequests: RequestItem[] }>("/api/friends")
      setFriends(data.friends)
      setIncoming(data.incomingRequests)
      setOutgoing(data.outgoingRequests)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) toast.error(e instanceof Error ? e.message : "好友数据加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => clearInterval(timer)
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ users: Friend[] }>(`/api/friends?q=${encodeURIComponent(q)}`)
        setResults(data.users)
      } catch {
        setResults([])
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [query])

  const action = async (key: string, body: object, success: string) => {
    setBusy(key)
    try {
      await api("/api/friends", { method: "POST", body: JSON.stringify(body) })
      toast.success(success)
      setQuery("")
      setResults([])
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" />我的好友</DialogTitle>
          <DialogDescription>好友关系保存在云端。换一台设备登录同一账号后仍然有效。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4" />添加好友</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入对方用户名" className="pl-9" />
            </div>
            {results.length > 0 && (
              <div className="mt-2 space-y-1">
                {results.map((item) => {
                  const key = `add-${item.id}`
                  const already = friends.some((f) => f.id === item.id)
                  const pending = outgoing.some((r) => r.receiver?.id === item.id)
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl bg-background px-3 py-2">
                      <UserAvatar user={item} className="h-9 w-9" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.username}</span>
                      <Button size="sm" variant="secondary" disabled={already || pending || !!busy} onClick={() => void action(key, { action: "request", username: item.username }, "好友请求已发送")}>
                        {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : already ? "已是好友" : pending ? "已发送" : "添加"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {incoming.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium">新的好友请求</h3>
              <div className="space-y-2">
                {incoming.map((r) => {
                  const sender = r.sender!
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-2xl border p-3">
                      <UserAvatar user={sender} className="h-10 w-10" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sender.username}</p><p className="text-xs text-muted-foreground">请求添加你为好友</p></div>
                      <Button size="icon" variant="secondary" disabled={!!busy} onClick={() => void action(`a-${r.id}`, { action: "accept", requestId: r.id }, "已添加好友")} aria-label="同意"><Check className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" disabled={!!busy} onClick={() => void action(`r-${r.id}`, { action: "reject", requestId: r.id }, "已拒绝")} aria-label="拒绝"><X className="h-4 w-4" /></Button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-medium">好友 {friends.length}</h3>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : friends.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">还没有好友，搜索用户名添加第一位好友吧。</div>
            ) : (
              <div className="space-y-1">
                {friends.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                    <UserAvatar user={item} className="h-10 w-10" />
                    <span className="flex-1 truncate text-sm font-medium">{item.username}</span>
                    <Button size="sm" variant="ghost" onClick={() => void action(`d-${item.id}`, { action: "remove", friendId: item.id }, "已解除好友")}>解除</Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
