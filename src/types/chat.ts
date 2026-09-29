export interface AuthUser {
  id: string
  username: string
  avatarColor: string
  createdAt: string
  phone?: string | null
}

/** 广场条目（来自碎碎念的日记 / 小确幸缓存） */
export interface SquareItem {
  id: string
  type: 'diary' | 'record'
  title: string | null
  content: string | null
  mood: string | null
  category: string | null
  images: string[] | null
  happenedAt: string | null
}

export interface SquareData {
  linked: boolean
  isSelf: boolean
  username: string
  avatarColor?: string
  phone?: string | null
  tokenAlive?: boolean
  syncedAt?: string | null
  items?: SquareItem[]
}

export interface MessageUser {
  id: string
  username: string
  avatarColor: string
}

export interface ChatMessage {
  id: string
  seq: number
  type: 'text' | 'file'
  content: string | null
  fileName: string | null
  fileType: string | null
  fileSize: number | null
  isImage: boolean
  createdAt: string
  user: MessageUser
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
