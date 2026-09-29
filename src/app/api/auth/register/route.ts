import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { hashPassword, pickAvatarColor, signToken } from '@/lib/auth'

export const runtime = 'nodejs'

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/

export async function POST(req: Request) {
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

  const existing = await query<{ id: string }>(
    'SELECT "id" FROM "User" WHERE "username" = $1',
    [username]
  )
  if (existing.length > 0) {
    return Response.json({ error: '该用户名已被注册' }, { status: 409 })
  }

  const rows = await query<{
    id: string
    username: string
    avatarColor: string
    createdAt: Date
  }>(
    `INSERT INTO "User" ("id", "username", "passwordHash", "avatarColor", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, now(), now())
     RETURNING "id", "username", "avatarColor", "createdAt"`,
    [randomUUID(), username, hashPassword(password), pickAvatarColor()]
  )
  const user = rows[0]

  const token = await signToken(user)
  return Response.json({ token, user })
}
