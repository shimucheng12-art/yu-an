import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SIZE = 2 * 1024 * 1024 // 2MB（客户端会先压缩）

/**
 * 上传头像（multipart form）：
 *   file    — 图片文件
 *   groupId — 可选，传了就是设置群头像，否则是个人头像
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const file = form.get('file')
  const groupIdRaw = form.get('groupId')
  const groupId = typeof groupIdRaw === 'string' && groupIdRaw ? groupIdRaw : null

  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: '请选择一张图片' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: '只支持图片文件' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: '图片太大，请换一张' }, { status: 400 })
  }

  // 群头像：需为群成员；个人头像：本人
  let oldAssetId: string | null = null
  if (groupId) {
    const rows = await query<{ avatarAssetId: string | null }>(
      `SELECT c."avatarAssetId"
       FROM "Conversation" c
       JOIN "GroupMember" gm ON gm."conversationId" = c."id" AND gm."userId" = $2
       WHERE c."id" = $1 AND c."isGroup"`,
      [groupId, user.id]
    )
    if (!rows[0]) return Response.json({ error: '群聊不存在' }, { status: 404 })
    oldAssetId = rows[0].avatarAssetId
  } else {
    oldAssetId = user.avatarImageId ?? null
  }

  const assetId = randomUUID()
  const data = Buffer.from(await file.arrayBuffer())

  await query(
    `INSERT INTO "FileAsset" ("id", "ownerId", "mime", "size", "data")
     VALUES ($1, $2, $3, $4, $5)`,
    [assetId, user.id, file.type, file.size, data]
  )

  if (groupId) {
    await query(`UPDATE "Conversation" SET "avatarAssetId" = $1 WHERE "id" = $2`, [assetId, groupId])
  } else {
    await query(`UPDATE "User" SET "avatarImageId" = $1, "updatedAt" = now() WHERE "id" = $2`, [assetId, user.id])
  }

  // 清理旧头像资产（存在时）
  if (oldAssetId && oldAssetId !== assetId) {
    await query(`DELETE FROM "FileAsset" WHERE "id" = $1 AND "ownerId" = $2`, [oldAssetId, user.id])
  }

  return Response.json({ avatarImageId: assetId })
}

/** 恢复默认颜色头像（个人） */
export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const old = user.avatarImageId ?? null
  await query(`UPDATE "User" SET "avatarImageId" = NULL, "updatedAt" = now() WHERE "id" = $1`, [user.id])
  if (old) {
    await query(`DELETE FROM "FileAsset" WHERE "id" = $1 AND "ownerId" = $2`, [old, user.id])
  }
  return Response.json({ ok: true })
}
