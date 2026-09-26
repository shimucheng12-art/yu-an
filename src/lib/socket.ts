'use client'

import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * 获取实时连接。
 * 连接地址优先取环境变量 NEXT_PUBLIC_SOCKET_URL（.env 中配置，如 http://localhost:3003），
 * 未配置时回退到网关相对路径（开发沙箱场景，由 Caddy 按 XTransformPort 转发）。
 */
export function getSocket(): Socket {
  if (socket) return socket
  const url = process.env.NEXT_PUBLIC_SOCKET_URL ?? '/?XTransformPort=3003'
  socket = io(url, {
    path: '/',
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  })
  return socket
}

export function destroySocket(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}
