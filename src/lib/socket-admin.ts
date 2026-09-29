/**
 * 消息广播（历史遗留接口，现为空操作）。
 *
 * 早期版本通过独立 socket.io 服务（端口 3003）推送实时消息；
 * 现已改为客户端轮询 /api/sync（3 秒），本函数仅保留签名以兼容调用方，
 * 不再引入任何 socket 依赖。
 */
export async function broadcastEvent(
  event: string,
  payload: unknown
): Promise<void> {
  void event
  void payload
}
