export interface AuthUser {
  id: string
  username: string
  avatarColor: string
  createdAt: string
  phone?: string | null
  bio?: string | null
  lastSeen?: string | null
}

/** 一对一会话（好友私聊） */
export interface ConversationItem {
  id: string
  friend: AuthUser
  lastMessage?: {
    content: string | null
    type: string
    createdAt: string
    senderName: string
  } | null
}

export interface ChatMessage {
  id: string
  seq: number
  type: 'text' | 'file' | 'voice'
  content: string | null
  fileName: string | null
  fileType: string | null
  fileSize: number | null
  isImage: boolean
  createdAt: string
  conversationId?: string | null
  user: MessageUser
}

export interface MessageUser {
  id: string
  username: string
  avatarColor: string
}

export interface OnlineUser {
  userId: string
  username: string
  color: string
}

export interface SystemNotice {
  id: string
  kind: 'join' | 'leave'
  username: string
  at: number
}

/** 广场条目（碎碎念日记/小确幸 + 余安自主帖子） */
export interface SquareItem {
  id: string
  type: 'diary' | 'record' | 'post'
  title: string | null
  content: string | null
  mood: string | null
  category: string | null
  images: string[] | null
  happenedAt: string | null
  createdAt?: string
  published?: boolean
}

export interface SquareData {
  linked: boolean
  isSelf: boolean
  username: string
  avatarColor?: string
  phone?: string | null
  tokenAlive?: boolean
  syncedAt?: string | null
  justSynced?: boolean
  items?: SquareItem[]
}
