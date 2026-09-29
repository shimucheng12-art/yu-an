import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 校验会话成员身份，返回对方用户行；非法返回 null */
async function loadConversation(conversationId: string, meId: string) {
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

/** 我的会话列表：好友信息 + 最近一条消息预览 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const rows = await query<{
    id: string
    friendId: string
    username: string
    avatarColor: string
    bio: string | null
    lastSeen: Date | null
    lastContent: string | null
    lastType: string | null
    lastAt: Date | null
  }>(
    `SELECT c."id",
            f."id" AS "friendId", f."username", f."avatarColor", f."bio", f."lastSeen",
            lm."content" AS "lastContent", lm."type" AS "lastType", lm."createdAt" AS "lastAt"
     FROM "Conversation" c
     JOIN "User" f ON f."id" = CASE WHEN c."userAId" = $1 THEN c."userBId" ELSE c."userAId" END
     LEFT JOIN LATERAL (
       SELECT m."content", m."type", m."createdAt"
       FROM "Message" m WHERE m."conversationId" = c."id"
       ORDER BY m."seq" DESC LIMIT 1
     ) lm ON true
     WHERE c."userAId" = $1 OR c."userBId" = $1
     ORDER BY COALESCE(lm."createdAt", c."createdAt") DESC`,
    [user.id]
  )

  return Response.json({
    conversations: rows.map((r) => ({
      id: r.id,
      friend: {
        id: r.friendId,
        username: r.username,
        avatarColor: r.avatarColor,
        bio: r.bio,
        lastSeen: r.lastSeen,
      },
      lastPreview:
        r.lastType === 'voice'
          ? '[语音]'
          : r.lastType === 'file'
            ? '[文件]'
            : (r.lastContent ?? ''),
      lastAt: r.lastAt,
    })),
  })
}

/** 与好友开启（或复用已存在的）一对一会话 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { friendId?: unknown; conversationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  // 按 id 打开会话（切换回已有私聊）
  if (typeof body.conversationId === 'string' && body.conversationId) {
    const conv = await loadConversation(body.conversationId, user.id)
    if (!conv) return Response.json({ error: '会话不存在' }, { status: 404 })
    return Response.json({
      conversation: {
        id: conv.id,
        friend: {
          id: conv.friendId,
          username: conv.username,
          avatarColor: conv.avatarColor,
          bio: conv.bio,
          lastSeen: conv.lastSeen,
        },
      },
    })
  }

  const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : ''
  if (!friendId || friendId === user.id) {
    return Response.json({ error: '参数错误' }, { status: 400 })
  }

  // 仅好友之间可建立私聊
  const friendRows = await query<{ username: string; avatarColor: string; bio: string | null; lastSeen: Date | null }>(
    `SELECT u."username", u."avatarColor", u."bio", u."lastSeen"
     FROM "Friendship" fr JOIN "User" u ON u."id" = fr."friendId"
     WHERE fr."userId" = $1 AND fr."friendId" = $2`,
    [user.id, friendId]
  )
  const friend = friendRows[0]
  if (!friend) {
    return Response.json({ error: '只有好友才能私聊' }, { status: 403 })
  }

  // 生成/获取会话（a<b 保证唯一）
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
      friend: {
        id: friendId,
        username: friend.username,
        avatarColor: friend.avatarColor,
        bio: friend.bio,
        lastSeen: friend.lastSeen,
      },
    },
  })
}
