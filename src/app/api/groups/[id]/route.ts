import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GroupRow {
  id: string
  name: string | null
  avatarAssetId: string | null
  createdBy: string | null
  myRole: string | null
}

interface MemberRow {
  id: string
  username: string
  avatarColor: string
  avatarImageId: string | null
  role: string
  lastSeen: Date | null
}

/** 加载群 + 校验我是成员 */
async function loadGroup(groupId: string, meId: string) {
  const rows = await query<GroupRow>(
    `SELECT c."id", c."name", c."avatarAssetId", c."createdBy", gm."role" AS "myRole"
     FROM "Conversation" c
     JOIN "GroupMember" gm ON gm."conversationId" = c."id" AND gm."userId" = $2
     WHERE c."id" = $1 AND c."isGroup"`,
    [groupId, meId]
  )
  return rows[0] ?? null
}

async function listMembers(groupId: string) {
  return query<MemberRow>(
    `SELECT u."id", u."username", u."avatarColor", u."avatarImageId", gm."role", u."lastSeen"
     FROM "GroupMember" gm JOIN "User" u ON u."id" = gm."userId"
     WHERE gm."conversationId" = $1
     ORDER BY CASE gm."role" WHEN 'owner' THEN 0 ELSE 1 END, u."username" ASC`,
    [groupId]
  )
}

/** 群详情：群信息 + 成员列表 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  const { id } = await ctx.params

  const group = await loadGroup(id, user.id)
  if (!group) return Response.json({ error: '群聊不存在' }, { status: 404 })

  const members = await listMembers(id)
  return Response.json({
    group: {
      id: group.id,
      name: group.name ?? '群聊',
      avatarImageId: group.avatarAssetId,
      createdBy: group.createdBy,
      myRole: group.myRole ?? 'member',
      isOwner: group.createdBy === user.id,
      members: members.map((m) => ({
        id: m.id,
        username: m.username,
        avatarColor: m.avatarColor,
        avatarImageId: m.avatarImageId,
        role: m.role,
        lastSeen: m.lastSeen,
      })),
    },
  })
}

/** 修改群信息：{ name? }（成员均可改） */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  const { id } = await ctx.params

  const group = await loadGroup(id, user.id)
  if (!group) return Response.json({ error: '群聊不存在' }, { status: 404 })

  let body: { name?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return Response.json({ error: '群名不能为空' }, { status: 400 })
  }
  const name = body.name.trim().slice(0, 30)

  await query(`UPDATE "Conversation" SET "name" = $1 WHERE "id" = $2`, [name, id])
  await query(
    `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId")
     VALUES ($1, 'system', $2, $3, $4)`,
    [randomUUID(), `"${user.username}" 将群名修改为 "${name}"`, user.id, id]
  )
  return Response.json({ ok: true, name })
}

/** 解散群聊（仅群主） */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  const { id } = await ctx.params

  const group = await loadGroup(id, user.id)
  if (!group) return Response.json({ error: '群聊不存在' }, { status: 404 })
  if (group.createdBy !== user.id) {
    return Response.json({ error: '只有群主才能解散群聊' }, { status: 403 })
  }

  await query(`DELETE FROM "GroupMember" WHERE "conversationId" = $1`, [id])
  await query(`DELETE FROM "Message" WHERE "conversationId" = $1`, [id])
  await query(`DELETE FROM "Conversation" WHERE "id" = $1`, [id])
  return Response.json({ ok: true })
}
