import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 轮询同步接口（无长连接平台如 Vercel 的实时替代方案）：
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

  const now = new Date()

  // 心跳 + 输入状态上报（一次写）
  await db.user.update({
    where: { id: user.id },
    data: {
      lastSeen: now,
      typingUntil: isTyping ? new Date(now.getTime() + TYPING_TTL_MS) : null,
    },
  })

  // 增量消息 + 在线成员，并行查询
  const [messages, activeUsers] = await Promise.all([
    db.message.findMany({
      where: { seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: 100,
      select: {
        id: true,
        seq: true,
        type: true,
        content: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        isImage: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatarColor: true } },
      },
    }),
    db.user.findMany({
      where: { lastSeen: { gt: new Date(now.getTime() - ONLINE_WINDOW_MS) } },
      select: { id: true, username: true, avatarColor: true, typingUntil: true },
      orderBy: { username: 'asc' },
    }),
  ])

  return Response.json({
    messages,
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
