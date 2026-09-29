import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { broadcastEvent } from '@/lib/socket-admin'
import { loadConversation } from '@/lib/conversation'
import { MESSAGE_SQL_SELECT, mapMessageRow, type MessageRow } from '@/lib/message-sql'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

function parseLimit(value: string | null): number {
  const n = Number.parseInt(value ?? '', 10)
  if (Number.isNaN(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/**
 * 拉取历史消息（云端持久化），支持 before 游标向上翻页。
 * ?conversation=<id> → 该私聊会话的消息；缺省 → 大厅（conversationId IS NULL）
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = parseLimit(searchParams.get('limit'))
  const beforeRaw = searchParams.get('before')
  const before = beforeRaw ? new Date(beforeRaw) : null
  const hasBefore = before !== null && !Number.isNaN(before.getTime())

  const conversationRaw = searchParams.get('conversation')
  let convFilter = 'm."conversationId" IS NULL'
  const params: unknown[] = []
  if (conversationRaw) {
    const conv = await loadConversation(conversationRaw, user.id)
    if (!conv) return Response.json({ error: '会话不存在' }, { status: 404 })
    params.push(conversationRaw)
    convFilter = `m."conversationId" = $${params.length}`
  }
  if (hasBefore) {
    params.push(before)
    convFilter += ` AND m."createdAt" < $${params.length}`
  }
  params.push(limit + 1)

  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_SQL_SELECT}
     FROM "Message" m JOIN "User" u ON u."id" = m."userId"
     WHERE ${convFilter}
     ORDER BY m."createdAt" DESC
     LIMIT $${params.length}`,
    params
  )

  const hasMore = rows.length > limit
  const page = (hasMore ? rows.slice(0, limit) : rows).map(mapMessageRow).reverse()

  return Response.json({ messages: page, hasMore })
}

/** 发送文字消息：持久化后广播（支持 conversationId 私聊） */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { content?: unknown; conversationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    return Response.json({ error: '消息内容不能为空' }, { status: 400 })
  }
  if (content.length > 4000) {
    return Response.json({ error: '消息过长（最多 4000 字）' }, { status: 400 })
  }

  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : null
  if (conversationId) {
    const conv = await loadConversation(conversationId, user.id)
    if (!conv) return Response.json({ error: '会话不存在' }, { status: 404 })
  }

  const rows = await query<{ id: string; seq: number; type: string; createdAt: Date }>(
    `INSERT INTO "Message" ("id", "type", "content", "userId", "conversationId", "createdAt")
     VALUES ($1, 'text', $2, $3, $4, now())
     RETURNING "id", "seq", "type", "createdAt"`,
    [randomUUID(), content, user.id, conversationId]
  )
  const r = rows[0]

  const message = {
    id: r.id,
    seq: r.seq,
    type: r.type,
    content,
    fileName: null,
    fileType: null,
    fileSize: null,
    isImage: false,
    createdAt: r.createdAt,
    conversationId,
    user: { id: user.id, username: user.username, avatarColor: user.avatarColor },
  }

  await broadcastEvent('new-message', message)
  return Response.json({ message })
}
