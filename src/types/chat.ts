export interface AuthUser {
  id: string
  username: string
  avatarColor: string
  createdAt: string
}

export interface MessageUser {
  id: string
  username: string
  avatarColor: string
}

export interface ChatMessage {
  id: string
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
  socketId: string
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
