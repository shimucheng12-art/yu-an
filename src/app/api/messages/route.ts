import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { broadcastEvent } from '@/lib/socket-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MESSAGE_SELECT = {
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
} as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

function parseLimit(value: string | null): number {
  const n = Number.parseInt(value ?? '', 10)
  if (Number.isNaN(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/** 拉取历史消息（云端持久化），支持 before 游标向上翻页 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = parseLimit(searchParams.get('limit'))
  const beforeRaw = searchParams.get('before')
  const before = beforeRaw ? new Date(beforeRaw) : null
  const hasBefore = before !== null && !Number.isNaN(before.getTime())

  const messages = await db.message.findMany({
    ...(hasBefore ? { where: { createdAt: { lt: before } } } : {}),
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: MESSAGE_SELECT,
  })

  const hasMore = messages.length > limit
  const page = (hasMore ? messages.slice(0, limit) : messages).reverse()

  return Response.json({ messages: page, hasMore })
}

/** 发送文字消息：持久化后广播 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { content?: unknown }
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

  const message = await db.message.create({
    data: { type: 'text', content, userId: user.id },
    select: MESSAGE_SELECT,
  })

  await broadcastEvent('new-message', message)
  return Response.json({ message })
}
