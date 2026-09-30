import type { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 头像图片：需要 Bearer 认证（登录用户即可访问，便于各处展示） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return Response.json({ error: '无效的头像 ID' }, { status: 400 })
  }

  const rows = await query<{ mime: string; data: Buffer }>(
    'SELECT "mime", "data" FROM "FileAsset" WHERE "id" = $1',
    [id]
  )
  const asset = rows[0]
  if (!asset) {
    return Response.json({ error: '头像不存在' }, { status: 404 })
  }

  return new Response(new Uint8Array(asset.data), {
    status: 200,
    headers: {
      'Content-Type': asset.mime,
      'Content-Length': String(asset.data.length),
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
