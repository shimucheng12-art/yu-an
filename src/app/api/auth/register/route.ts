import { db } from '@/lib/db'
import { hashPassword, pickAvatarColor, signToken } from '@/lib/auth'

export const runtime = 'nodejs'

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/

export async function POST(req: Request) {
  // 临时调试：把真实错误返回给客户端（定位云端问题后移除）
  try {
    return await handleRegister(req)
  } catch (err) {
    return Response.json(
      {
        error: 'REG_DEBUG',
        detail: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? '').slice(0, 600) : undefined,
      },
      { status: 500 }
    )
  }
}

async function handleRegister(req: Request) {
  let body: { username?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!USERNAME_RE.test(username)) {
    return Response.json(
      { error: '用户名需为 2-20 个字符，仅支持中文、字母、数字、下划线和连字符' },
      { status: 400 }
    )
  }
  if (password.length < 6 || password.length > 64) {
    return Response.json({ error: '密码长度需为 6-64 位' }, { status: 400 })
  }

  const existing = await db.user.findUnique({ where: { username } })
  if (existing) {
    return Response.json({ error: '该用户名已被注册' }, { status: 409 })
  }

  const user = await db.user.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      avatarColor: pickAvatarColor(),
    },
    select: { id: true, username: true, avatarColor: true, createdAt: true },
  })

  const token = await signToken(user)
  return Response.json({ token, user })
}
