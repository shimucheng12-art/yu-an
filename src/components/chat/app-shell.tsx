'use client'

import { useCallback, useState } from 'react'
import { BookHeart, MessageCircle, User, Users } from 'lucide-react'
import type { AuthUser, ConversationItem } from '@/types/chat'
import { cn } from '@/lib/utils'
import { ConversationsView, markRead } from '@/components/chat/conversations-view'
import { ContactsView } from '@/components/chat/contacts-view'
import { ProfileView } from '@/components/chat/profile-view'
import { SquareView } from '@/components/chat/square-view'
import { ChatApp } from '@/components/chat/chat-app'
import { FriendsDialog } from '@/components/chat/friends-dialog'

type Tab = 'chats' | 'contacts' | 'square' | 'me'

interface Props {
  user: AuthUser
  onLogout: () => void
  onUserUpdated: (user: AuthUser, token?: string) => void
}

type ChatTarget = { kind: 'hall' } | { kind: 'conv'; conv: ConversationItem }

/** 微信式主界面：底部 4 Tab（消息/联系人/广场/我的），聊天页全屏覆盖 */
export function AppShell({ user, onLogout, onUserUpdated }: Props) {
  const [tab, setTab] = useState<Tab>('chats')
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null)
  const [friendsOpen, setFriendsOpen] = useState(false)

  const openConversation = useCallback((conv: ConversationItem) => {
    markRead(conv.id)
    setChatTarget({ kind: 'conv', conv })
  }, [])

  const openHall = useCallback(() => {
    setChatTarget({ kind: 'hall' })
  }, [])

  const exitChat = useCallback(() => setChatTarget(null), [])

  const tabs: { key: Tab; label: string; icon: typeof MessageCircle }[] = [
    { key: 'chats', label: '消息', icon: MessageCircle },
    { key: 'contacts', label: '联系人', icon: Users },
    { key: 'square', label: '广场', icon: BookHeart },
    { key: 'me', label: '我的', icon: User },
  ]

  const activeConvId = chatTarget?.kind === 'conv' ? chatTarget.conv.id : null

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col overflow-hidden bg-background text-foreground">
      {/* Tab 内容区 */}
      <main className="relative min-h-0 flex-1">
        {tab === 'chats' && (
          <ConversationsView
            user={user}
            activeConversationId={activeConvId}
            onOpenHall={openHall}
            onOpenConversation={openConversation}
          />
        )}
        {tab === 'contacts' && (
          <ContactsView user={user} onOpenConversation={openConversation} onOpenAddFriend={() => setFriendsOpen(true)} />
        )}
        {tab === 'square' && <SquareView user={user} />}
        {tab === 'me' && <ProfileView user={user} onLogout={onLogout} onUserUpdated={onUserUpdated} />}
      </main>

      {/* 底部 Tab 栏 */}
      <nav className="flex shrink-0 items-stretch border-t bg-background/95 backdrop-blur pb-[max(0.25rem,env(safe-area-inset-bottom))]" aria-label="主导航">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            type="button"
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors',
              tab === key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      {/* 聊天页（全屏覆盖） */}
      {chatTarget && (
        <div className="absolute inset-0 z-50 bg-background">
          <ChatApp
            key={chatTarget.kind === 'conv' ? chatTarget.conv.id : 'hall'}
            user={user}
            onLogout={onLogout}
            onUserUpdated={onUserUpdated}
            initialConversation={chatTarget.kind === 'conv' ? chatTarget.conv : null}
            onExit={exitChat}
            onConversationUpdated={(patch) => {
              if (chatTarget.kind === 'conv') {
                setChatTarget({ kind: 'conv', conv: { ...chatTarget.conv, ...patch } })
              }
            }}
            onConversationClosed={exitChat}
          />
        </div>
      )}

      {/* 添加好友（从联系人页进入） */}
      <FriendsDialog user={user} open={friendsOpen} onOpenChange={setFriendsOpen} />
    </div>
  )
}
