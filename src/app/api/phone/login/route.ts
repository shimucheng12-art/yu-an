import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, pickAvatarColor, signToken } from '@/lib/auth'
import { fcSmsLogin, fcGetData, syncSquareFromBlob, PHONE_RE } from '@/lib/suisuinian'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/
const CODE_RE = /^\d{6}$/

/** 手机号验证码登录 / 注册 / 给当前账号绑定手机号（碎碎念账号联动） */
export async function POST(req: Request) {
  let body: { phone?: unknown; code?: unknown; username?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const desiredUsername = typeof body.username === 'string' ? body.username.trim() : ''

  if (!PHONE_RE.test(phone)) {
    return Response.json({ error: '请输入正确的 11 位手机号' }, { status: 400 })
  }
  if (!CODE_RE.test(code)) {
    return Response.json({ error: '请输入 6 位短信验证码' }, { status: 400 })
  }

  // 1. 碎碎念侧校验验证码，换取 FC token
  let fc
  try {
    fc = await fcSmsLogin(phone, code)
  } catch (e) {
    const err = e as { message?: string }
    return Response.json({ error: err.message ?? '验证失败，请稍后重试' }, { status: 502 })
  }

  // 2. 解析目标余安账号
  const current = await getUserFromRequest(req) // 已登录用户（绑定场景）
  const existingRows = await query<{ id: string; username: string }>(
    'SELECT "id", "username" FROM "User" WHERE "phone" = $1',
    [phone]
  )
  const existing = existingRows[0]

  let userId: string

  if (existing) {
    // 手机号已绑定账号
    if (current && current.id !== existing.id) {
      return Response.json({ error: '该手机号已绑定其他账号' }, { status: 409 })
    }
    userId = existing.id
  } else if (current) {
    // 未绑定任何账号 + 当前已登录 → 绑定到当前账号
    userId = current.id
  } else {
    // 未绑定任何账号 + 未登录 → 注册新账号
    let username = desiredUsername
    if (!USERNAME_RE.test(username)) {
      return Response.json(
        { error: '昵称需为 2-20 个字符，仅支持中文、字母、数字、下划线和连字符' },
        { status: 400 }
      )
    }
    const taken = await query<{ id: string }>('SELECT "id" FROM "User" WHERE "username" = $1', [
      username,
    ])
    if (taken.length > 0) {
      return Response.json({ error: '该昵称已被使用，换一个吧' }, { status: 409 })
    }
    const created = await query<{ id: string }>(
      `INSERT INTO "User" ("id", "username", "passwordHash", "avatarColor", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now()) RETURNING "id"`,
      [randomUUID(), username, '', pickAvatarColor()]
    )
    userId = created[0].id
  }

  // 3. 记录碎碎念授权（token 有效期内可后台刷新广场数据）
  const expiresAt = new Date(fc.expires_at * 1000).toISOString()
  await query(
    `UPDATE "User" SET "phone" = $2, "fcUserId" = $3, "fcToken" = $4,
       "fcTokenExpiresAt" = $5, "updatedAt" = now() WHERE "id" = $1`,
    [userId, phone, fc.user_id, fc.token, expiresAt]
  )

  // 4. 立即同步一次广场（失败不影响登录）
  let squareSynced = false
  try {
    const res = await fcGetData(fc.token)
    if (res?.data) {
      await syncSquareFromBlob(userId, res.data)
      squareSynced = true
    }
  } catch {
    // 同步失败容忍：稍后可在广场页重试
  }

  // 5. 签发余安 token
  const rows = await query<{
    id: string
    username: string
    avatarColor: string
    createdAt: Date
    phone: string | null
  }>(
    'SELECT "id", "username", "avatarColor", "createdAt", "phone" FROM "User" WHERE "id" = $1',
    [userId]
  )
  const user = rows[0]
  const token = await signToken(user)
  return Response.json({ token, user, squareSynced })
}
