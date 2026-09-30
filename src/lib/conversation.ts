import { query } from '@/lib/db'

/** 私聊会话（对方用户信息） */
export interface DmConversation {
  kind: 'dm'
  id: string
  friendId: string
  username: string
  avatarColor: string
  avatarImageId: string | null
  bio: string | null
  lastSeen: Date | null
}

/** 群聊会话（群信息） */
export interface GroupConversation {
  kind: 'group'
  id: string
  name: string | null
  avatarAssetId: string | null
  createdBy: string | null
  memberCount: number
}

export type AnyConversation = DmConversation | GroupConversation

/** 校验会话成员身份（私聊 = 双方；群聊 = GroupMember 存在）；非法返回 null */
export async function loadConversation(conversationId: string, meId: string): Promise<AnyConversation | null> {
  const rows = await query<{ kind: string; id: string; name: string | null; avatarAssetId: string | null; createdBy: string | null; memberCount: number; friendId: string | null; username: string | null; avatarColor: string | null; avatarImageId: string | null; bio: string | null; lastSeen: Date | null }>(
    `SELECT CASE WHEN c."isGroup" THEN 'group' ELSE 'dm' END AS "kind",
            c."id", c."name", c."avatarAssetId", c."createdBy",
            (SELECT count(*)::int FROM "GroupMember" gm WHERE gm."conversationId" = c."id") AS "memberCount",
            f."id" AS "friendId", f."username", f."avatarColor", f."avatarImageId", f."bio", f."lastSeen"
     FROM "Conversation" c
     LEFT JOIN "User" f ON f."id" = CASE WHEN c."isGroup" THEN NULL
                                        WHEN c."userAId" = $2 THEN c."userBId" ELSE c."userAId" END
     WHERE c."id" = $1
       AND (
         (NOT c."isGroup" AND (c."userAId" = $2 OR c."userBId" = $2))
         OR (c."isGroup" AND EXISTS (
              SELECT 1 FROM "GroupMember" gm
              WHERE gm."conversationId" = c."id" AND gm."userId" = $2))
       )`,
    [conversationId, meId]
  )
  const r = rows[0]
  if (!r) return null
  if (r.kind === 'group') {
    return {
      kind: 'group',
      id: r.id,
      name: r.name,
      avatarAssetId: r.avatarAssetId,
      createdBy: r.createdBy,
      memberCount: r.memberCount,
    }
  }
  return {
    kind: 'dm',
    id: r.id,
    friendId: r.friendId ?? '',
    username: r.username ?? '',
    avatarColor: r.avatarColor ?? '#10b981',
    avatarImageId: r.avatarImageId,
    bio: r.bio,
    lastSeen: r.lastSeen,
  }
}
