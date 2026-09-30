/** 消息查询共用的 SQL 片段与行映射（pg 版本） */

export const MESSAGE_SQL_SELECT = `m."id", m."seq", m."type", m."content", m."fileName", m."fileType", m."fileSize", m."isImage", m."createdAt", u."id" AS "userId", u."username", u."avatarColor", u."avatarImageId"`

export interface MessageRow {
  id: string
  seq: number
  type: string
  content: string | null
  fileName: string | null
  fileType: string | null
  fileSize: number | null
  isImage: boolean
  createdAt: Date
  userId: string
  username: string
  avatarColor: string
  avatarImageId: string | null
}

/** 扁平行 → 客户端消息结构（与原 Prisma 返回保持一致） */
export function mapMessageRow(r: MessageRow) {
  return {
    id: r.id,
    seq: r.seq,
    type: r.type,
    content: r.content,
    fileName: r.fileName,
    fileType: r.fileType,
    fileSize: r.fileSize,
    isImage: r.isImage,
    createdAt: r.createdAt,
    user: { id: r.userId, username: r.username, avatarColor: r.avatarColor, avatarImageId: r.avatarImageId },
  }
}
