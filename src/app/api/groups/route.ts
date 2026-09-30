import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_NAME = 30

/** 创建群聊：{ name?, memberIds: string[] }（成员须为自己的好友） */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { name?: unknown; memberIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!Array.isArray(body.memberIds) || body.memberIds.length === 0) {
    return Response.json({ error: '请至少选择一位好友' }, { status: 400 })
  }
  const memberIds = [...new Set(body.memberIds.filter((v): v is string => typeof v === 'string' && v.length > 0 && v !== user.id))]
  if (memberIds.length === 0) {
    return Response.json({ error: '请至少选择一位好友' }, { status: 400 })
  }

  // 校验全部是好友
  const friendRows = await query<{ id: string; username: string }>(
    `SELECT u."id", u."username"
     FROM "Friendship" fr JOIN "User" u ON u."id" = fr."friendId"
     WHERE fr."userId" = $1 AND fr."friendId" = ANY($2)`,
    [user.id, memberIds]
  )
  if (friendRows.length !== memberIds.length) {
    return Response.json({ error: '只能邀请自己的好友' }, { status: 403 })
  }

  const groupId = randomUUID()
  const groupName = name || `${user.username} 创建的群聊`
  const memberNames = friendRows.map((f) => f.username).join('、')

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO "Conversation" ("id", "userAId", "userBId", "createdAt", "isGroup", "name", "createdBy")
       VALUES ($1, $2, $2, now(), true, $3, $2)`,
      [groupId, user.id, groupName]
    )
    await client.query(
      `INSERT INTO "GroupMember" ("conversationId", "userId", "role")
       VALUES ($1, $2, 'owner')`,
      [groupId, user.id]
    )
    await client.query(
      `INSERT INTO "GroupMember" ("conversationId", "userId", "role")
       SELECT $1, id, 'member' FROM "User" WHERE "id" = ANY($2)`,
      [groupId, memberIds]
    )
    await client.query(
      `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId")
       VALUES ($1, 'system', $2, $3, $4)`,
      [randomUUID(), `"${user.username}" 创建了群聊，成员：${user.username}、${memberNames}`, user.id, groupId]
    )
  })

  return Response.json({
    conversation: {
      id: groupId,
      kind: 'group' as const,
      name: groupName,
      avatarImageId: null,
      memberCount: memberIds.length + 1,
    },
  })
}
