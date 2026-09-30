'use client'

/**
 * 头像图片缓存：/api/avatar/:id 需要认证头，
 * 用 objectURL 做会话级缓存，避免列表页反复请求。
 */
import { getToken } from '@/lib/api-client'

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

/** 获取头像 URL（objectURL，带内存缓存）；失败返回 null */
export function getAvatarUrl(assetId: string): Promise<string | null> {
  const hit = cache.get(assetId)
  if (hit) return Promise.resolve(hit)

  const inflight = pending.get(assetId)
  if (inflight) return inflight

  const p = (async () => {
    try {
      const token = getToken()
      const res = await fetch(`/api/avatar/${assetId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return null
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) return null
      const url = URL.createObjectURL(blob)
      cache.set(assetId, url)
      return url
    } catch {
      return null
    } finally {
      pending.delete(assetId)
    }
  })()
  pending.set(assetId, p)
  return p
}

/** 同步读取缓存（首次渲染无闪烁） */
export function peekAvatarUrl(assetId: string): string | null {
  return cache.get(assetId) ?? null
}
