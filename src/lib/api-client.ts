'use client'

export const TOKEN_KEY = 'yuan-token'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY)
}

/** 统一的请求封装：自动附带 Bearer Token，统一错误处理 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const isJsonBody = typeof init.body === 'string'
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* 无 JSON body */
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（${res.status}）`
    throw new ApiError(message, res.status)
  }
  return data as T
}

/** 携带认证获取文件二进制 */
export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken()
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    throw new ApiError(`文件获取失败（${res.status}）`, res.status)
  }
  return res.blob()
}

/** 通过 blob 触发浏览器下载（文件接口需要认证头，不能直接用链接） */
export async function downloadBlob(path: string, fileName: string): Promise<void> {
  const blob = await fetchBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
