import type { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { MESSAGE_SQL_SELECT, mapMessageRow, type MessageRow } from '@/lib/message-sql'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 轮询同步接口（无长连接平台的实时替代方案）：
 * - GET /api/sync?after=<seq>&typing=0|1
 * - 副作用：刷新当前用户 lastSeen（心跳），按需续期 typingUntil（正在输入）
 * - 返回：增量消息（seq > after）+ 在线成员 + 正在输入的其他成员
 *
 * 一个请求完成心跳/输入上报/数据拉取，客户端每 3 秒调用一次。
 */

// 在线判定窗口：客户端 3 秒一跳，容错 4 次丢包
const ONLINE_WINDOW_MS = 15_000
// 输入提示有效期：客户端持续输入时每次轮询都会续期
const TYPING_TTL_MS = 6_000

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const afterRaw = searchParams.get('after')
  const after = Number.parseInt(afterRaw ?? '', 10)
  const afterSeq = Number.isNaN(after) || after < 0 ? 0 : after
  const isTyping = searchParams.get('typing') === '1'

  // conversation 参数：私聊会话增量；缺省 → 大厅
  const conversationRaw = searchParams.get('conversation')
  let convFilter = 'm."conversationId" IS NULL'
  if (conversationRaw) {
    const { loadConversation } = await import('@/lib/conversation')
    const conv = await loadConversation(conversationRaw, user.id)
    if (!conv) return Response.json({ error: '会话不存在' }, { status: 404 })
    convFilter = 'm."conversationId" = $2'
  }

  const now = new Date()
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS)
  const typingUntil = isTyping ? new Date(now.getTime() + TYPING_TTL_MS) : null

  // 心跳 + 输入状态上报（一次写）
  await query(
    'UPDATE "User" SET "lastSeen" = $1, "typingUntil" = $2, "updatedAt" = now() WHERE "id" = $3',
    [now, typingUntil, user.id]
  )

  // 增量消息 + 在线成员，并行查询
  const [messageRows, activeUsers] = await Promise.all([
    query<MessageRow>(
      `SELECT ${MESSAGE_SQL_SELECT}
       FROM "Message" m JOIN "User" u ON u."id" = m."userId"
       WHERE m."seq" > $1 AND ${convFilter}
       ORDER BY m."seq" ASC
       LIMIT 100`,
      conversationRaw ? [afterSeq, conversationRaw] : [afterSeq]
    ),
    query<{
      id: string
      username: string
      avatarColor: string
      typingUntil: Date | null
    }>(
      `SELECT "id", "username", "avatarColor", "typingUntil"
       FROM "User"
       WHERE "lastSeen" > $1
       ORDER BY "username" ASC`,
      [onlineSince]
    ),
  ])

  return Response.json({
    messages: messageRows.map(mapMessageRow),
    online: activeUsers.map((u) => ({
      userId: u.id,
      username: u.username,
      color: u.avatarColor,
    })),
    typing: activeUsers
      .filter((u) => u.id !== user.id && u.typingUntil && u.typingUntil.getTime() > now.getTime())
      .map((u) => ({ userId: u.id, username: u.username })),
    serverTime: now.toISOString(),
  })
}
