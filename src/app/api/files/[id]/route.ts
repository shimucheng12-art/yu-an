import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads')

/** 下载 / 预览文件：需要 Bearer 认证，文件本体以 <messageId>.bin 存于服务器 */
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

  const message = await db.message.findUnique({ where: { id } })
  if (!message || message.type !== 'file') {
    return Response.json({ error: '文件不存在' }, { status: 404 })
  }

  const filePath = path.join(UPLOAD_DIR, `${message.id}.bin`)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    const buffer = await readFile(filePath)
    const body = new Uint8Array(buffer)

    const encodedName = encodeURIComponent(message.fileName ?? 'file')
    const asciiFallback = (message.fileName ?? 'file').replace(/[^\x20-\x7e]/g, '_')

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': message.fileType || 'application/octet-stream',
        'Content-Length': String(info.size),
        'Content-Disposition': `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return Response.json({ error: '文件已丢失或已被清理' }, { status: 404 })
  }
}
