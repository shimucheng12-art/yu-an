import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 下载 / 预览文件：需要 Bearer 认证，文件本体存于数据库（Message.fileData） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { id } = await params
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return Response.json({ error: '无效的文件 ID' }, { status: 400 })
  }

  const message = await db.message.findUnique({
    where: { id },
    select: { fileName: true, fileType: true, fileSize: true, fileData: true },
  })
  if (!message || !message.fileData) {
    return Response.json({ error: '文件已丢失或已被清理' }, { status: 404 })
  }

  const encodedName = encodeURIComponent(message.fileName ?? 'file')
  const asciiFallback = (message.fileName ?? 'file').replace(/[^\x20-\x7e]/g, '_')

  return new Response(new Uint8Array(message.fileData), {
    status: 200,
    headers: {
      'Content-Type': message.fileType || 'application/octet-stream',
      'Content-Length': String(message.fileData.length),
      'Content-Disposition': `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
