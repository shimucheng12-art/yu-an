import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { broadcastEvent } from '@/lib/socket-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel serverless 请求体上限约 4.5MB，客户端会先把图片压缩到该限内
const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB

/** 清理文件名中的控制字符与路径分隔符，保留中文等正常字符 */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned.slice(0, 120) || 'unnamed'
}

/** 上传文件：保存到服务器（云端储存），生成文件消息并广播 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: '上传请求格式错误' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: '未找到上传的文件' }, { status: 400 })
  }
  if (file.size <= 0) {
    return Response.json({ error: '文件不能为空' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: '文件大小不能超过 4MB（图片会自动压缩后上传）' }, { status: 413 })
  }

  const displayName = sanitizeFileName(file.name || 'unnamed')
  const mimeType = file.type || 'application/octet-stream'
  const isImage = mimeType.startsWith('image/')

  // 文件二进制直接存数据库（serverless 平台文件系统只读，不能落盘）
  let fileData: Buffer
  try {
    fileData = Buffer.from(await file.arrayBuffer())
  } catch {
    return Response.json({ error: '文件读取失败，请重试' }, { status: 500 })
  }

  const rows = await query<{ id: string; seq: number; type: string; createdAt: Date }>(
    `INSERT INTO "Message" ("id", "type", "fileName", "fileType", "fileSize", "isImage", "fileData", "userId", "createdAt")
     VALUES ($1, 'file', $2, $3, $4, $5, $6, $7, now())
     RETURNING "id", "seq", "type", "createdAt"`,
    [randomUUID(), displayName, mimeType, file.size, isImage, fileData, user.id]
  ).catch(() => null)

  if (!rows || rows.length === 0) {
    return Response.json({ error: '文件保存失败，请重试' }, { status: 500 })
  }
  const r = rows[0]

  const message = {
    id: r.id,
    seq: r.seq,
    type: r.type,
    content: null,
    fileName: displayName,
    fileType: mimeType,
    fileSize: file.size,
    isImage,
    createdAt: r.createdAt,
    user: { id: user.id, username: user.username, avatarColor: user.avatarColor },
  }

  await broadcastEvent('new-message', message)
  return Response.json({ message })
}
