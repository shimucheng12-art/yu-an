import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { loadConversation } from '@/lib/conversation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ConvRow {
  id: string
  kind: 'dm' | 'group'
  friendId: string | null
  username: string | null
  avatarColor: string | null
  avatarImageId: string | null
  bio: string | null
  lastSeen: Date | null
  name: string | null
  memberCount: number | null
  lastContent: string | null
  lastType: string | null
  lastAt: Date | null
  senderName: string | null
}

/** 我的会话列表：私聊 + 群聊，含最近一条消息预览 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const rows = await query<ConvRow>(
    `SELECT * FROM (
       -- 私聊
       SELECT c."id", 'dm' AS "kind",
              f."id" AS "friendId", f."username", f."avatarColor", f."avatarImageId", f."bio", f."lastSeen",
              NULL AS "name", NULL::int AS "memberCount",
              lm."content" AS "lastContent", lm."type" AS "lastType", lm."createdAt" AS "lastAt", lm."senderName"
       FROM "Conversation" c
       JOIN "User" f ON f."id" = CASE WHEN c."userAId" = $1 THEN c."userBId" ELSE c."userAId" END
       LEFT JOIN LATERAL (
         SELECT m."content", m."type", m."createdAt", u."username" AS "senderName"
         FROM "Message" m JOIN "User" u ON u."id" = m."userId" WHERE m."conversationId" = c."id"
         ORDER BY m."seq" DESC LIMIT 1
       ) lm ON true
       WHERE NOT c."isGroup" AND (c."userAId" = $1 OR c."userBId" = $1)

       UNION ALL

       -- 群聊
       SELECT c."id", 'group' AS "kind",
              NULL AS "friendId", NULL AS "username", NULL AS "avatarColor", NULL AS "avatarImageId",
              NULL AS "bio", NULL AS "lastSeen",
              c."name",
              (SELECT count(*)::int FROM "GroupMember" gm WHERE gm."conversationId" = c."id") AS "memberCount",
              lm."content" AS "lastContent", lm."type" AS "lastType", lm."createdAt" AS "lastAt", lm."senderName"
       FROM "Conversation" c
       JOIN "GroupMember" me ON me."conversationId" = c."id" AND me."userId" = $1
       LEFT JOIN LATERAL (
         SELECT m."content", m."type", m."createdAt", u."username" AS "senderName"
         FROM "Message" m JOIN "User" u ON u."id" = m."userId" WHERE m."conversationId" = c."id"
         ORDER BY m."seq" DESC LIMIT 1
       ) lm ON true
       WHERE c."isGroup"
     ) t
     ORDER BY COALESCE("lastAt", (SELECT "createdAt" FROM "Conversation" cc WHERE cc."id" = t."id")) DESC`,
    [user.id]
  )

  return Response.json({
    conversations: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      ...(r.kind === 'dm'
        ? {
            friend: {
              id: r.friendId,
              username: r.username,
              avatarColor: r.avatarColor,
              avatarImageId: r.avatarImageId,
              bio: r.bio,
              lastSeen: r.lastSeen,
            },
          }
        : {
            name: r.name ?? '群聊',
            avatarImageId: r.avatarImageId ?? null,
            memberCount: r.memberCount ?? 0,
          }),
      lastMessage:
        r.lastAt && r.lastType
          ? {
              content: r.lastContent,
              type: r.lastType,
              createdAt: r.lastAt,
              senderName: r.senderName ?? '',
            }
          : null,
      lastAt: r.lastAt,
    })),
  })
}

/** 打开（或创建）会话：传 conversationId 切换；传 friendId 新开私聊 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { friendId?: unknown; conversationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof body.conversationId === 'string' && body.conversationId) {
    const conv = await loadConversation(body.conversationId, user.id)
    if (!conv) return Response.json({ error: '会话不存在' }, { status: 404 })
    return Response.json({ conversation: summaryOf(conv) })
  }

  const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : ''
  if (!friendId || friendId === user.id) {
    return Response.json({ error: '参数错误' }, { status: 400 })
  }

  const friendRows = await query<{
    id: string
    username: string
    avatarColor: string
    avatarImageId: string | null
    bio: string | null
    lastSeen: Date | null
  }>(
    `SELECT u."id", u."username", u."avatarColor", u."avatarImageId", u."bio", u."lastSeen"
     FROM "Friendship" fr JOIN "User" u ON u."id" = fr."friendId"
     WHERE fr."userId" = $1 AND fr."friendId" = $2`,
    [user.id, friendId]
  )
  const friend = friendRows[0]
  if (!friend) {
    return Response.json({ error: '只有好友才能私聊' }, { status: 403 })
  }

  const [a, b] = [user.id, friendId].sort()
  await query(
    `INSERT INTO "Conversation" ("id", "userAId", "userBId", "createdAt")
     VALUES ($1, $2, $3, now())
     ON CONFLICT ("userAId", "userBId") DO NOTHING`,
    [randomUUID(), a, b]
  )
  const convRows = await query<{ id: string }>(
    'SELECT "id" FROM "Conversation" WHERE "userAId" = $1 AND "userBId" = $2',
    [a, b]
  )

  return Response.json({
    conversation: {
      id: convRows[0].id,
      kind: 'dm' as const,
      friend: {
        id: friend.id,
        username: friend.username,
        avatarColor: friend.avatarColor,
        avatarImageId: friend.avatarImageId,
        bio: friend.bio,
        lastSeen: friend.lastSeen,
      },
    },
  })
}

/** 通用会话 → 前端摘要 */
function summaryOf(conv: Awaited<ReturnType<typeof loadConversation>>) {
  if (!conv) throw new Error('unreachable')
  if (conv.kind === 'group') {
    return {
      id: conv.id,
      kind: 'group' as const,
      name: conv.name ?? '群聊',
      avatarImageId: conv.avatarAssetId,
      memberCount: conv.memberCount,
    }
  }
  return {
    id: conv.id,
    kind: 'dm' as const,
    friend: {
      id: conv.friendId,
      username: conv.username,
      avatarColor: conv.avatarColor,
      avatarImageId: conv.avatarImageId,
      bio: conv.bio,
      lastSeen: conv.lastSeen,
    },
  }
}
