import type { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { getUserFromRequest, signToken, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/
const MAX_BIO = 100

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  return Response.json({ user })
}

/** 编辑个人资料：昵称（username）与简介（bio） */
export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: { username?: unknown; bio?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const sets: string[] = []
  const params: unknown[] = []
  const updates: { username?: string; bio?: string } = {}

  if (body.username !== undefined) {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!USERNAME_RE.test(username)) {
      return Response.json(
        { error: '昵称需为 2-20 个字符，仅支持中文、字母、数字、下划线和连字符' },
        { status: 400 }
      )
    }
    if (username !== user.username) {
      const taken = await query<{ id: string }>(
        'SELECT "id" FROM "User" WHERE "username" = $1 AND "id" <> $2',
        [username, user.id]
      )
      if (taken.length > 0) {
        return Response.json({ error: '这个昵称已被占用' }, { status: 409 })
      }
      params.push(username)
      sets.push(`"username" = $${params.length}`)
      updates.username = username
    }
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, MAX_BIO) : ''
    params.push(bio)
    sets.push(`"bio" = $${params.length}`)
    updates.bio = bio
  }

  if (sets.length === 0) {
    return Response.json({ user })
  }

  params.push(user.id)
  const rows = await query<{
    id: string
    username: string
    avatarColor: string
    createdAt: Date
    phone: string | null
    bio: string | null
  }>(
    `UPDATE "User" SET ${sets.join(', ')}, "updatedAt" = now()
     WHERE "id" = $${params.length}
     RETURNING "id", "username", "avatarColor", "createdAt", "phone", "bio"`,
    params
  )
  const updated = rows[0]
  // 昵称变了要换发 token（JWT 里带 username 展示用）
  const token = updates.username ? await signToken(updated) : null
  return Response.json({ user: updated, token })
}
