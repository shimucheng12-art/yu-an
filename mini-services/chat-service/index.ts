import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { jwtVerify } from 'jose'

/**
 * 余安实时服务（端口 3003）：
 * - 校验 JWT 后登记在线状态，广播 presence / 加入离开通知
 * - 转发“正在输入”提示
 * - 接收 Next.js API 的内部广播（需 INTERNAL_SECRET），把新消息推给所有客户端
 *
 * 说明：本服务的运行目录不是项目根，运行时不会自动加载项目根的 .env，
 * 因此这里手动读取 <项目根>/.env（如果存在）。
 */
function loadEnvFromProjectRoot() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const envPath = join(dir, '..', '..', '.env')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    /* .env 不存在时忽略，使用环境变量或默认值 */
  }
}
loadEnvFromProjectRoot()

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-fallback-secret-do-not-use-in-prod'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'dev-internal-secret'
// Render 等平台通过 PORT 环境变量分配端口，本地开发默认 3003
const PORT = Number(process.env.PORT ?? 3003)

const secretKey = new TextEncoder().encode(JWT_SECRET)

interface OnlineUser {
  socketId: string
  userId: string
  username: string
  color: string
}

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
})

// socketId -> 用户；userId -> 同一用户打开的连接数（多端/多标签页）
const onlineUsers = new Map<string, OnlineUser>()
const userSocketCount = new Map<string, number>()

function broadcastPresence() {
  const seen = new Set<string>()
  const users: OnlineUser[] = []
  for (const u of onlineUsers.values()) {
    if (seen.has(u.userId)) continue
    seen.add(u.userId)
    users.push({ socketId: u.socketId, userId: u.userId, username: u.username, color: u.color })
  }
  io.emit('presence', { users })
}

io.on('connection', (socket) => {
  // 客户端携带 JWT 加入，验证通过才登记在线状态
  socket.on('join', async (data: { token?: string } | undefined) => {
    let payload: { sub?: string; username?: string; color?: string } | null = null
    try {
      const verified = await jwtVerify(data?.token ?? '', secretKey)
      payload = verified.payload as typeof payload
    } catch {
      socket.emit('auth-error', { message: '身份验证失败' })
      return
    }
    const userId = payload.sub
    const username = payload.username
    if (!userId || !username) {
      socket.emit('auth-error', { message: '身份验证失败' })
      return
    }

    onlineUsers.set(socket.id, {
      socketId: socket.id,
      userId,
      username,
      color: typeof payload.color === 'string' ? payload.color : '#10b981',
    })
    userSocketCount.set(userId, (userSocketCount.get(userId) ?? 0) + 1)

    // 首个连接上线时广播加入通知
    if (userSocketCount.get(userId) === 1) {
      io.emit('chat-notice', { kind: 'join', username })
    }
    broadcastPresence()
    socket.emit('joined', { ok: true })
  })

  // 正在输入提示（不持久化）
  socket.on('typing', (data: { isTyping?: boolean } | undefined) => {
    const user = onlineUsers.get(socket.id)
    if (!user) return
    socket.broadcast.emit('user-typing', {
      userId: user.userId,
      username: user.username,
      isTyping: Boolean(data?.isTyping),
    })
  })

  // Next.js API 的内部广播通道（需内部密钥）
  socket.on('internal:broadcast', (data: { secret?: string; event?: string; payload?: unknown } | undefined) => {
    if (!data || data.secret !== INTERNAL_SECRET || typeof data.event !== 'string') return
    io.emit(data.event, data.payload)
  })

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id)
    if (!user) return
    onlineUsers.delete(socket.id)
    const count = (userSocketCount.get(user.userId) ?? 1) - 1
    if (count <= 0) {
      userSocketCount.delete(user.userId)
      io.emit('chat-notice', { kind: 'leave', username: user.username })
    } else {
      userSocketCount.set(user.userId, count)
    }
    broadcastPresence()
  })

  socket.on('error', (error: unknown) => {
    console.error(`[chat-service] socket error (${socket.id}):`, error)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[chat-service] listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
