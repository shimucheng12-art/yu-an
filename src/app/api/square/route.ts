import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { fcGetData, syncSquareFromBlob } from '@/lib/suisuinian'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 广场缓存自动刷新阈值：超过 5 分钟且 token 有效则尝试拉取最新 */
const AUTO_REFRESH_MS = 5 * 60 * 1000
const MAX_ITEMS = 50
const MAX_POST_TEXT = 2000
const MAX_POST_IMAGES = 3
const MAX_POST_BYTES = 2 * 1024 * 1024

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

interface FeedItem {
  id: string
  type: 'diary' | 'record' | 'post'
  title: string | null
  content: string | null
  mood: string | null
  category: string | null
  images: string[] | null
  happenedAt: Date | null
  createdAt: Date
}

/** 广场聚合视图：已发布的碎碎念日记/小确幸 + 余安自主发布的帖子；非好友一律 403 */
export async function GET(req: NextRequest) {
  const me = await getUserFromRequest(req)
  if (!me) return unauthorized()

  // ---- 管理视图：我的全部条目（含未发布）+ 我的帖子，供发布管理页使用 ----
  if (req.nextUrl.searchParams.get('mine') === 'items') {
    const mine = await query<TargetRow>(
      `SELECT "id", "username", "avatarColor", "phone", "fcUserId", "fcToken", "fcTokenExpiresAt", "fcSyncedAt"
       FROM "User" WHERE "id" = $1`,
      [me.id]
    )
    const target = mine[0]
    const tokenAlive =
      !!target?.fcToken &&
      !!target?.fcTokenExpiresAt &&
      new Date(target.fcTokenExpiresAt).getTime() > Date.now() + 60_000

    const [items, posts] = await Promise.all([
      query<{
        id: string
        type: string
        title: string | null
        content: string | null
        mood: string | null
        category: string | null
        images: string[] | null
        happenedAt: Date | null
        published: boolean
      }>(
        `SELECT "id", "type", "title", "content", "mood", "category", "images", "happenedAt", "published"
         FROM "SquareItem" WHERE "userId" = $1
         ORDER BY "happenedAt" DESC NULLS LAST LIMIT 100`,
        [me.id]
      ),
      query<FeedItem>(
        `SELECT "id", 'post' AS "type", NULL AS "title", "text" AS "content", NULL AS "mood",
                NULL AS "category", "images", NULL AS "happenedAt", "createdAt"
         FROM "SquarePost" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 100`,
        [me.id]
      ),
    ])
    return Response.json({
      linked: !!target?.fcUserId,
      isSelf: true,
      username: me.username,
      avatarColor: me.avatarColor,
      phone: target?.phone ?? null,
      tokenAlive,
      syncedAt: target?.fcSyncedAt ?? null,
      items: items.map((it) => ({
        id: it.id,
        type: it.type,
        title: it.title,
        content: it.content,
        mood: it.mood,
        category: it.category,
        images: Array.isArray(it.images) ? it.images : null,
        happenedAt: it.happenedAt,
        published: it.published,
      })),
      posts: posts.map(mapFeedItem),
    })
  }

  // ---- 普通视图：自己或好友的公开内容 ----
  const usernameParam = (req.nextUrl.searchParams.get('username') ?? '').trim()
  let target: TargetRow | undefined
  let isSelf = false

  if (!usernameParam || usernameParam === me.username) {
    isSelf = true
    const rows = await query<TargetRow>(
      `SELECT "id", "username", "avatarColor", "phone", "fcUserId", "fcToken", "fcTokenExpiresAt", "fcSyncedAt"
       FROM "User" WHERE "id" = $1`,
      [me.id]
    )
    target = rows[0]
  } else {
    const rows = await query<TargetRow>(
      `SELECT "id", "username", "avatarColor", "phone", "fcUserId", "fcToken", "fcTokenExpiresAt", "fcSyncedAt"
       FROM "User" WHERE "username" = $1`,
      [usernameParam]
    )
    target = rows[0]
    if (!target) return Response.json({ error: '没有找到这个用户' }, { status: 404 })

    const friends = await query(
      'SELECT 1 FROM "Friendship" WHERE "userId" = $1 AND "friendId" = $2',
      [me.id, target.id]
    )
    if (friends.length === 0) {
      return Response.json({ error: '只有好友才能访问对方的广场' }, { status: 403 })
    }
  }

  const tokenAlive =
    !!target?.fcToken &&
    !!target?.fcTokenExpiresAt &&
    new Date(target.fcTokenExpiresAt).getTime() > Date.now() + 60_000

  // 缓存过期且有有效 token → 后台静默刷新（仅自己的；好友的靠他本人登录时刷新）
  let syncedOk = false
  if (isSelf && tokenAlive && target?.fcToken) {
    const stale =
      target.fcSyncedAt == null ||
      Date.now() - new Date(target.fcSyncedAt).getTime() > AUTO_REFRESH_MS
    if (stale) {
      try {
        const res = await fcGetData(target.fcToken)
        if (res?.data) {
          await syncSquareFromBlob(target.id, res.data)
          syncedOk = true
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
  }

  const feed = await query<FeedItem>(
    `SELECT "id", "type", "title", "content", "mood", "category", "images", "happenedAt", "createdAt"
     FROM (
       SELECT "id", "type", "title", "content", "mood", "category", "images", "happenedAt",
              "createdAt" FROM "SquareItem" WHERE "userId" = $1 AND "published" = true
       UNION ALL
       SELECT "id", 'post' AS "type", NULL AS "title", "text" AS "content", NULL AS "mood",
              NULL AS "category", "images", NULL AS "happenedAt", "createdAt"
       FROM "SquarePost" WHERE "userId" = $1
     ) feed
     ORDER BY COALESCE("happenedAt", "createdAt") DESC
     LIMIT ${MAX_ITEMS}`,
    [target!.id]
  )

  return Response.json({
    linked: !!target!.fcUserId,
    isSelf,
    username: target!.username,
    avatarColor: target!.avatarColor,
    phone: isSelf ? target!.phone : null,
    tokenAlive,
    syncedAt: target!.fcSyncedAt,
    justSynced: syncedOk,
    items: feed.map(mapFeedItem),
  })
}

function mapFeedItem(it: FeedItem) {
  return {
    id: it.id,
    type: it.type,
    title: it.title,
    content: it.content,
    mood: it.mood,
    category: it.category,
    images: Array.isArray(it.images) ? it.images : null,
    happenedAt: it.happenedAt,
    createdAt: it.createdAt,
  }
}

/** 广场操作：发布/取消发布碎碎念条目、发布/删除自主帖子 */
export async function POST(req: NextRequest) {
  const me = await getUserFromRequest(req)
  if (!me) return unauthorized()

  let body: {
    action?: unknown
    itemIds?: unknown
    published?: unknown
    text?: unknown
    images?: unknown
    id?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }
  const action = typeof body.action === 'string' ? body.action : ''

  // 发布/取消发布选中的碎碎念条目
  if (action === 'publish') {
    const ids = Array.isArray(body.itemIds)
      ? body.itemIds.filter((x): x is string => typeof x === 'string' && x.length > 2)
      : []
    const published = body.published !== false
    if (ids.length === 0) {
      return Response.json({ error: '没有选择任何内容' }, { status: 400 })
    }
    if (ids.length > 100) {
      return Response.json({ error: '一次最多操作 100 条' }, { status: 400 })
    }
    await query(
      `UPDATE "SquareItem" SET "published" = $2 WHERE "userId" = $1 AND "id" = ANY($3::text[])`,
      [me.id, published, ids]
    )
    return Response.json({ ok: true, count: ids.length, published })
  }

  // 发布自主帖子（文字 + 图片）
  if (action === 'createPost') {
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_POST_TEXT) : ''
    const images = Array.isArray(body.images)
      ? body.images.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/'))
      : []
    if (!text && images.length === 0) {
      return Response.json({ error: '帖子内容不能为空' }, { status: 400 })
    }
    if (images.length > MAX_POST_IMAGES) {
      return Response.json({ error: `最多 ${MAX_POST_IMAGES} 张图片` }, { status: 400 })
    }
    const totalBytes = images.reduce((n, s) => n + s.length, 0)
    if (totalBytes > MAX_POST_BYTES) {
      return Response.json({ error: '图片太大，请压缩后重试' }, { status: 413 })
    }

    const rows = await query<{ id: string; createdAt: Date }>(
      `INSERT INTO "SquarePost" ("id", "userId", "text", "images", "createdAt")
       VALUES ($1, $2, $3, $4::jsonb, now())
       RETURNING "id", "createdAt"`,
      [randomUUID(), me.id, text || null, JSON.stringify(images.length ? images : null)]
    )
    return Response.json({
      post: { id: rows[0].id, text: text || null, images: images.length ? images : null, createdAt: rows[0].createdAt },
    })
  }

  // 删除自己的帖子
  if (action === 'deletePost') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return Response.json({ error: '参数错误' }, { status: 400 })
    const rows = await query(
      'DELETE FROM "SquarePost" WHERE "id" = $1 AND "userId" = $2 RETURNING "id"',
      [id, me.id]
    )
    if (rows.length === 0) {
      return Response.json({ error: '帖子不存在' }, { status: 404 })
    }
    return Response.json({ ok: true })
  }

  return Response.json({ error: '未知操作' }, { status: 400 })
}
