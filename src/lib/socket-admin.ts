import { io, type Socket } from 'socket.io-client'

/**
 * 服务端内部广播通道：Next.js API 持久化消息后，
 * 通过 socket.io 客户端把消息推给聊天服务（端口 3003），再由其广播给所有在线客户端。
 */
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL ?? 'http://localhost:3003'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'dev-internal-secret'

let socketPromise: Promise<Socket> | null = null

function ensureAdminSocket(): Promise<Socket> {
  if (socketPromise) return socketPromise

  socketPromise = new Promise<Socket>((resolve, reject) => {
    const socket = io(CHAT_SERVICE_URL, {
      path: '/',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 5000,
    })

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.close()
      socketPromise = null
      reject(new Error('chat service connect timeout'))
    }, 6000)

    socket.on('connect', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(socket)
    })

    socket.on('connect_error', () => {
      if (settled) return
      // 首次连接失败时交由超时统一处理，保持 reconnection 继续尝试
    })

    socket.on('disconnect', () => {
      // 连接断开后重建，下次调用 ensureAdminSocket 会重新连接
      socketPromise = null
    })
  })

  return socketPromise
}

/** 广播失败不影响消息持久化结果，仅记录日志 */
export async function broadcastEvent(event: string, payload: unknown): Promise<void> {
  try {
    const socket = await ensureAdminSocket()
    socket.emit('internal:broadcast', { secret: INTERNAL_SECRET, event, payload })
  } catch (err) {
    console.error('[socket-admin] broadcast failed:', err)
  }
}
