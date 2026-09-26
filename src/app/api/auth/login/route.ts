import { db } from '@/lib/db'
import { signToken, verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { username?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return Response.json({ error: '请输入用户名和密码' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: '用户名或密码错误' }, { status: 401 })
  }

  const safeUser = {
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  }
  const token = await signToken(safeUser)
  return Response.json({ token, user: safeUser })
}
