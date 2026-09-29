import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { fcGetData, syncSquareFromBlob } from '@/lib/suisuinian'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 广场缓存自动刷新阈值：超过 5 分钟且 token 有效则尝试拉取最新 */
const AUTO_REFRESH_MS = 5 * 60 * 1000
const MAX_ITEMS = 50

interface TargetRow {
  id: string
  username: string
  avatarColor: string
  phone: string | null
  fcUserId: string | null
  fcToken: string | null
  fcTokenExpiresAt: Date | null
  fcSyncedAt: Date | null
}

interface ItemRow {
  id: string
  type: string
  title: string | null
  content: string | null
  mood: string | null
  category: string | null
  images: string[] | null
  happenedAt: Date | null
}

/** 广场：自己或好友的碎碎念（日记 + 小确幸）聚合视图，非好友一律 403 */
export async function GET(req: NextRequest) {
  const me = await getUserFromRequest(req)
  if (!me) return unauthorized()

  const usernameParam = (req.nextUrl.searchParams.get('username') ?? '').trim()
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'

  // 解析目标用户（不传 username = 看自己）
  let target: TargetRow | null
  if (!usernameParam || usernameParam === me.username) {
    const rows = await query<TargetRow>(
      `SELECT "id", "username", "avatarColor", "phone", "fcUserId", "fcToken",
              "fcTokenExpiresAt", "fcSyncedAt" FROM "User" WHERE "id" = $1`,
      [me.id]
    )
    target = rows[0] ?? null
  } else {
    const rows = await query<TargetRow>(
      `SELECT "id", "username", "avatarColor", "phone", "fcUserId", "fcToken",
              "fcTokenExpiresAt", "fcSyncedAt" FROM "User" WHERE "username" = $1`,
      [usernameParam]
    )
    target = rows[0] ?? null
    if (!target) return Response.json({ error: '没有找到这个用户' }, { status: 404 })

    // 好友门禁：仅好友可访问对方广场
    const friendRows = await query(
      'SELECT 1 FROM "Friendship" WHERE "userId" = $1 AND "friendId" = $2',
      [me.id, target.id]
    )
    if (friendRows.length === 0) {
      return Response.json({ error: '只有好友才能访问对方的广场' }, { status: 403 })
    }
  }

  if (!target) return Response.json({ error: '用户不存在' }, { status: 404 })
  const isSelf = target.id === me.id

  // 未绑定碎碎念账号
  if (!target.fcUserId) {
    return Response.json({ linked: false, isSelf, username: target.username })
  }

  const tokenAlive =
    target.fcTokenExpiresAt != null &&
    new Date(target.fcTokenExpiresAt).getTime() > Date.now() + 60_000

  // 数据刷新：token 有效且（手动刷新 或 缓存过期 5 分钟）
  const stale =
    target.fcSyncedAt == null || Date.now() - new Date(target.fcSyncedAt).getTime() > AUTO_REFRESH_MS
  let syncedOk = false
  if (tokenAlive && target.fcToken && (refresh || stale)) {
    try {
      const res = await fcGetData(target.fcToken)
      if (res?.data) {
        await syncSquareFromBlob(target.id, res.data)
        syncedOk = true
        // 重新读一次同步时间
        const rows = await query<{ fcSyncedAt: Date }>(
          'SELECT "fcSyncedAt" FROM "User" WHERE "id" = $1',
          [target.id]
        )
        if (rows[0]) target.fcSyncedAt = rows[0].fcSyncedAt
      }
    } catch {
      // 拉取失败则回落缓存
    }
  }

  const items = await query<ItemRow>(
    `SELECT "id", "type", "title", "content", "mood", "category", "images", "happenedAt"
     FROM "SquareItem" WHERE "userId" = $1
     ORDER BY "happenedAt" DESC NULLS LAST LIMIT ${MAX_ITEMS}`,
    [target.id]
  )

  return Response.json({
    linked: true,
    isSelf,
    username: target.username,
    avatarColor: target.avatarColor,
    phone: isSelf ? target.phone : null,
    tokenAlive,
    syncedAt: target.fcSyncedAt,
    justSynced: syncedOk,
    items: items.map((it) => ({
      id: it.id,
      type: it.type,
      title: it.title,
      content: it.content,
      mood: it.mood,
      category: it.category,
      images: Array.isArray(it.images) ? it.images : null,
      happenedAt: it.happenedAt,
    })),
  })
}
