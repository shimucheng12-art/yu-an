import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 邀请好友入群：{ userIds: string[] }（群成员均可邀请） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  const { id } = await ctx.params

  const groupRows = await query<{ name: string | null; createdBy: string }>(
    `SELECT c."name", c."createdBy"
     FROM "Conversation" c
     JOIN "GroupMember" gm ON gm."conversationId" = c."id" AND gm."userId" = $2
     WHERE c."id" = $1 AND c."isGroup"`,
    [id, user.id]
  )
  if (!groupRows[0]) return Response.json({ error: '群聊不存在' }, { status: 404 })

  let body: { userIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }
  if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
    return Response.json({ error: '请选择要邀请的好友' }, { status: 400 })
  }
  const userIds = [...new Set(body.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0 && v !== user.id))]
  if (userIds.length === 0) {
    return Response.json({ error: '请选择要邀请的好友' }, { status: 400 })
  }

  // 只能邀请自己的好友
  const friendRows = await query<{ id: string; username: string }>(
    `SELECT fr."friendId" AS "id", u."username"
     FROM "Friendship" fr JOIN "User" u ON u."id" = fr."friendId"
     WHERE fr."userId" = $1 AND fr."friendId" = ANY($2)`,
    [user.id, userIds]
  )
  if (friendRows.length === 0) {
    return Response.json({ error: '只能邀请自己的好友' }, { status: 403 })
  }

  for (const f of friendRows) {
    await query(
      `INSERT INTO "GroupMember" ("conversationId", "userId", "role")
       VALUES ($1, $2, 'member')
       ON CONFLICT ("conversationId", "userId") DO NOTHING`,
      [id, f.id]
    )
  }
  const names = friendRows.map((f) => `"${f.username}"`).join('、')
  await query(
    `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId")
     VALUES ($1, 'system', $2, $3, $4)`,
    [randomUUID(), `"${user.username}" 邀请 ${names} 加入了群聊`, user.id, id]
  )
  return Response.json({ ok: true, added: friendRows.length })
}

/** 踢人（?userId=xxx，仅群主）或退群（?userId=self 或缺省） */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  const { id } = await ctx.params
  const targetId = new URL(req.url).searchParams.get('userId') ?? user.id

  const groupRows = await query<{ createdBy: string }>(
    `SELECT c."createdBy"
     FROM "Conversation" c
     JOIN "GroupMember" gm ON gm."conversationId" = c."id" AND gm."userId" = $2
     WHERE c."id" = $1 AND c."isGroup"`,
    [id, user.id]
  )
  const group = groupRows[0]
  if (!group) return Response.json({ error: '群聊不存在' }, { status: 404 })

  // 踢人
  if (targetId !== user.id) {
    if (group.createdBy !== user.id) {
      return Response.json({ error: '只有群主才能移出成员' }, { status: 403 })
    }
    if (targetId === group.createdBy) {
      return Response.json({ error: '不能移出群主' }, { status: 400 })
    }
    const targetRows = await query<{ username: string }>(`SELECT "username" FROM "User" WHERE "id" = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return Response.json({ error: '用户不存在' }, { status: 404 })

    await query(`DELETE FROM "GroupMember" WHERE "conversationId" = $1 AND "userId" = $2`, [id, targetId])
    await query(
      `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId")
       VALUES ($1, 'system', $2, $3, $4)`,
      [randomUUID(), `"${user.username}" 将 "${target.username}" 移出了群聊`, user.id, id]
    )
    return Response.json({ ok: true })
  }

  // 退群；群主调用则解散整个群（清理消息与成员）
  if (group.createdBy === user.id) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM "Message" WHERE "conversationId" = $1`, [id])
      await client.query(`DELETE FROM "GroupMember" WHERE "conversationId" = $1`, [id])
      await client.query(`DELETE FROM "Conversation" WHERE "id" = $1`, [id])
    })
    return Response.json({ ok: true, dissolved: true })
  }
  await query(`DELETE FROM "GroupMember" WHERE "conversationId" = $1 AND "userId" = $2`, [id, user.id])
  await query(
    `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId")
     VALUES ($1, 'system', $2, $3, $4)`,
    [randomUUID(), `"${user.username}" 退出了群聊`, user.id, id]
  )
  return Response.json({ ok: true })
}
