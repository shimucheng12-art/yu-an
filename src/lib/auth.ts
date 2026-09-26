import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { db } from '@/lib/db'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-fallback-secret-do-not-use-in-prod'
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

const USER_SELECT = {
  id: true,
  username: true,
  avatarColor: true,
  createdAt: true,
} as const

/** 优先从 Authorization: Bearer 解析当前用户，解析失败返回 null */
export async function getUserFromRequest(req: Request): Promise<SafeUser | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey)
    const userId = typeof payload.sub === 'string' ? payload.sub : null
    if (!userId) return null
    const user = await db.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    })
    return user
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
