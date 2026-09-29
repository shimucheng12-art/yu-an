import { query } from '@/lib/db'
import { PHONE_RE } from '@/lib/suisuinian'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 查询手机号是否已绑定余安账号（供登录页决定是否显示昵称输入框） */
export async function GET(req: NextRequest) {
  const phone = (req.nextUrl.searchParams.get('phone') ?? '').trim()
  if (!PHONE_RE.test(phone)) {
    return Response.json({ error: '手机号格式不正确' }, { status: 400 })
  }
  const rows = await query<{ id: string }>('SELECT "id" FROM "User" WHERE "phone" = $1', [phone])
  return Response.json({ exists: rows.length > 0 })
}
