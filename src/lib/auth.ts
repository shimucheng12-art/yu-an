import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { query } from '@/lib/db'

// JWT 密钥：优先用环境变量（须非空）；否则从 DATABASE_URL 派生。
// 注意：?? 防不住「空字符串」（Vercel 上误配空 JWT_SECRET 曾导致
// "Zero-length key" 崩溃），所以这里显式做非空校验。
const envJwtSecret = process.env.JWT_SECRET?.trim()
const JWT_SECRET = envJwtSecret
  ? envJwtSecret
  : createHash('sha256')
      .update(`yuan-beta-jwt-v1:${process.env.DATABASE_URL?.trim() ?? ''}`)
      .digest('hex')
const secretKey = new TextEncoder().encode(JWT_SECRET)

export interface SafeUser {
  id: string
  username: string
  avatarColor: string
  createdAt: Date
}

/** scrypt 加盐哈希，格式：salt:hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export async function signToken(user: {
  id: string
  username: string
  avatarColor: string
}): Promise<string> {
  return new SignJWT({ username: user.username, color: user.avatarColor })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey)
}

/** 优先从 Authorization: Bearer 解析当前用户，解析失败返回 null */
export async function getUserFromRequest(req: Request): Promise<SafeUser | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey)
    const userId = typeof payload.sub === 'string' ? payload.sub : null
    if (!userId) return null
    const rows = await query<{
      id: string
      username: string
      avatarColor: string
      createdAt: Date
    }>('SELECT "id", "username", "avatarColor", "createdAt" FROM "User" WHERE "id" = $1', [userId])
    return rows[0] ?? null
  } catch {
    return null
  }
}

export function unauthorized() {
  return Response.json({ error: '登录已失效，请重新登录' }, { status: 401 })
}

/** 头像配色（避开蓝色系） */
const AVATAR_COLORS = [
  '#10b981', // emerald
  '#14b8a6', // teal
  '#84cc16', // lime
  '#eab308', // yellow
  '#f97316', // orange
  '#f43f5e', // rose
  '#ec4899', // pink
  '#a855f7', // purple
]

export function pickAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
}
