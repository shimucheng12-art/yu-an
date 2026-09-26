import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { broadcastEvent } from '@/lib/socket-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads')

const MESSAGE_SELECT = {
  id: true,
  type: true,
  content: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  isImage: true,
  createdAt: true,
  user: { select: { id: true, username: true, avatarColor: true } },
} as const

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
    return Response.json({ error: '文件大小不能超过 20MB' }, { status: 413 })
  }

  const displayName = sanitizeFileName(file.name || 'unnamed')
  const mimeType = file.type || 'application/octet-stream'
  const isImage = mimeType.startsWith('image/')

  // 先建消息记录拿到唯一 id，再以 <id>.bin 落盘，路径完全不可控 => 无穿越风险
  const message = await db.message.create({
    data: {
      type: 'file',
      fileName: displayName,
      fileType: mimeType,
      fileSize: file.size,
      isImage,
      userId: user.id,
    },
    select: MESSAGE_SELECT,
  })

  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(UPLOAD_DIR, `${message.id}.bin`), buffer)
  } catch (err) {
    await db.message.delete({ where: { id: message.id } }).catch(() => {})
    console.error('[upload] save file failed:', err)
    return Response.json({ error: '文件保存失败，请重试' }, { status: 500 })
  }

  await broadcastEvent('new-message', message)
  return Response.json({ message })
}
