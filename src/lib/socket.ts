'use client'

/**
 * 实时连接（历史遗留接口，现为空操作）。
 *
 * 早期版本通过 socket.io 建立长连接；现已改为轮询 /api/sync（3 秒），
 * 本文件仅保留 destroySocket 签名供页面卸载清理时调用，
 * 不再引入任何 socket 依赖。
 */
export function destroySocket(): void {
  /* 空操作 */
}
