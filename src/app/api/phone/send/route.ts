import { fcSmsSend, PHONE_RE } from '@/lib/suisuinian'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 发送碎碎念短信验证码（代理阿里云 FC，FC 侧自带 60s 间隔与每日上限） */
export async function POST(req: Request) {
  let body: { phone?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!PHONE_RE.test(phone)) {
    return Response.json({ error: '请输入正确的 11 位手机号' }, { status: 400 })
  }
  try {
    await fcSmsSend(phone)
    return Response.json({ ok: true })
  } catch (e) {
    const err = e as { status?: number; message?: string; retryAfterMs?: number }
    if (err.status === 429) {
      return Response.json(
        { error: err.message ?? '发送太频繁，请稍后再试', retryAfterMs: err.retryAfterMs },
        { status: 429 }
      )
    }
    return Response.json({ error: err.message ?? '验证码发送失败，请稍后重试' }, { status: 502 })
  }
}
