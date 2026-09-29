import { query } from '@/lib/db'

/**
 * 碎碎念（美好生活记录）云服务联动库
 *
 * 碎碎念后端 = 阿里云函数计算（国内直连），接口：
 *   POST /api/auth/sms/send  {phone}            → 发送短信验证码（FC 侧已限流）
 *   POST /api/auth/sms/login {phone, code}       → 校验验证码，返回 {token, phone, user_id, expires_at}
 *   GET  /api/data（Bearer token）               → 拉取该账号完整数据包（日记/小确幸/树洞…，上限 2MB）
 *
 * 余安服务端作为代理调用（服务器到服务器，不受浏览器 CORS 白名单限制）。
 */

// 与 db.ts 同风格：优先读环境变量，未配置时用内置地址
const envFcBase = process.env.FC_API_BASE?.trim()
const FC_BASE = envFcBase || 'https://life-diary-api-icegmnxkgp.cn-hangzhou.fcapp.run'

export const PHONE_RE = /^1[3-9]\d{9}$/

/** 碎碎念数据包里的条目类型（仅声明我们关心的部分） */
interface SuiRecord {
  id?: string
  text?: string
  mood?: string
  category?: string
  images?: unknown
  time?: string
}
interface SuiDiary {
  id?: string
  title?: string
  content?: string
  mood?: string
  date?: string
  createTime?: string
}
export interface SuiBlob {
  records?: SuiRecord[]
  diaries?: SuiDiary[]
  [key: string]: unknown
}

/** 统一的 FC 请求封装 */
async function fcFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${FC_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) },
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* FC 偶发返回非 JSON（网关错误页）时按空体处理 */
    }
    if (!res.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `碎碎念服务请求失败（${res.status}）`
      const err = new Error(message) as Error & { status?: number; retryAfterMs?: number }
      err.status = res.status
      if (
        body &&
        typeof body === 'object' &&
        'retry_after' in body &&
        typeof (body as { retry_after: unknown }).retry_after === 'number'
      ) {
        err.retryAfterMs = (body as { retry_after: number }).retry_after
      }
      throw err
    }
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

/** 发送短信验证码（代理 FC，FC 侧自带 60s 间隔与每日上限） */
export function fcSmsSend(phone: string): Promise<unknown> {
  return fcFetch('/api/auth/sms/send', { method: 'POST', body: JSON.stringify({ phone }) })
}

export interface FcLoginResult {
  token: string
  phone: string
  user_id: string
  expires_at: number // 秒级时间戳
}

/** 短信验证码登录（代理 FC；验证通过即碎碎念账号注册/登录成功） */
export async function fcSmsLogin(phone: string, code: string): Promise<FcLoginResult> {
  return fcFetch<FcLoginResult>('/api/auth/sms/login', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  })
}

/** 用碎碎念 token 拉取数据包；未登录/过期返回 null */
export async function fcGetData(token: string): Promise<{ data: SuiBlob | null } | null> {
  try {
    return await fcFetch<{ data: SuiBlob | null }>('/api/data', {
      headers: { authorization: `Bearer ${token}` },
    })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401) return null
    throw e
  }
}

/** 把碎碎念数据包中「日记 + 小确幸」写入余安广场缓存（整删整插，简单且幂等） */
export async function syncSquareFromBlob(userId: string, blob: SuiBlob): Promise<number> {
  const diaries = Array.isArray(blob.diaries) ? blob.diaries : []
  const records = Array.isArray(blob.records) ? blob.records : []

  type Row = {
    id: string
    type: 'diary' | 'record'
    title: string | null
    content: string | null
    mood: string | null
    category: string | null
    images: string[] | null
    happenedAt: string | null
  }
  const rows: Row[] = []

  for (const d of diaries) {
    if (!d || typeof d !== 'object') continue
    rows.push({
      id: `d:${String(d.id ?? '')}`,
      type: 'diary',
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 200) : null,
      content: typeof d.content === 'string' ? d.content.slice(0, 10_000) : null,
      mood: typeof d.mood === 'string' ? d.mood.slice(0, 50) : null,
      category: null,
      images: null,
      happenedAt: typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.date) ? d.date : typeof d.createTime === 'string' ? d.createTime : null,
    })
  }
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    let images: string[] | null = null
    if (Array.isArray(r.images)) {
      const list = r.images.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image'))
      if (list.length > 0) images = list.slice(0, 9).map((x) => x.slice(0, 1_500_000))
    }
    rows.push({
      id: `r:${String(r.id ?? '')}`,
      type: 'record',
      title: null,
      content: typeof r.text === 'string' ? r.text.slice(0, 5_000) : null,
      mood: typeof r.mood === 'string' ? r.mood.slice(0, 50) : null,
      category: typeof r.category === 'string' ? r.category.slice(0, 30) : null,
      images,
      happenedAt: typeof r.time === 'string' ? r.time : null,
    })
  }

  await query('DELETE FROM "SquareItem" WHERE "userId" = $1', [userId])
  for (const row of rows) {
    if (!row.id || row.id.length <= 2) continue
    await query(
      `INSERT INTO "SquareItem" ("id", "userId", "type", "title", "content", "mood", "category", "images", "happenedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), now())
       ON CONFLICT ("id") DO NOTHING`,
      [row.id, userId, row.type, row.title, row.content, row.mood, row.category, JSON.stringify(row.images), row.happenedAt]
    )
  }
  await query('UPDATE "User" SET "fcSyncedAt" = now() WHERE "id" = $1', [userId])
  return rows.length
}
