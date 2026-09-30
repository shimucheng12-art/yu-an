export interface AuthUser {
  id: string
  username: string
  avatarColor: string
  avatarImageId?: string | null
  createdAt: string
  phone?: string | null
  bio?: string | null
  lastSeen?: string | null
}

/** 会话（好友私聊或群聊） */
export interface ConversationItem {
  id: string
  kind: 'dm' | 'group'
  /** 私聊对方（dm） */
  friend?: AuthUser
  /** 群名（group） */
  name?: string | null
  /** 群/用户头像（group=群头像；dm=对方头像） */
  avatarImageId?: string | null
  /** 群成员数（group） */
  memberCount?: number
  /** 我是否群主（group） */
  isOwner?: boolean
  lastMessage?: {
    content: string | null
    type: string
    createdAt: string
    senderName: string
  } | null
  lastAt?: string | null
}

export interface ChatMessage {
  id: string
  seq: number
  type: 'text' | 'file' | 'voice' | 'system'
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
  avatarImageId?: string | null
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
