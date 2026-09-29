import { query } from '@/lib/db'

/** 校验会话成员身份，返回对方用户行；非法返回 null */
export async function loadConversation(conversationId: string, meId: string) {
  const rows = await query<{
    id: string
    userAId: string
    userBId: string
    friendId: string
    username: string
    avatarColor: string
    bio: string | null
    lastSeen: Date | null
  }>(
    `SELECT c."id", c."userAId", c."userBId",
            f."id" AS "friendId", f."username", f."avatarColor", f."bio", f."lastSeen"
     FROM "Conversation" c
     JOIN "User" f ON f."id" = CASE WHEN c."userAId" = $2 THEN c."userBId" ELSE c."userAId" END
     WHERE c."id" = $1 AND (c."userAId" = $2 OR c."userBId" = $2)`,
    [conversationId, meId]
  )
  return rows[0] ?? null
}
