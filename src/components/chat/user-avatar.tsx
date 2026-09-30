'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { getAvatarUrl, peekAvatarUrl } from '@/lib/avatar-cache'

interface Props {
  user: { username: string; avatarColor: string; avatarImageId?: string | null }
  className?: string
  /** 群头像：无图片时显示群样式（多人图标） */
  group?: { name?: string | null; avatarImageId?: string | null }
}

/** 用户/群头像：优先图片头像，否则用户名首字符 + 专属颜色 */
export function UserAvatar({ user, className, group }: Props) {
  const assetId = group ? group.avatarImageId : user.avatarImageId
  const [url, setUrl] = useState<string | null>(assetId ? peekAvatarUrl(assetId) : null)

  useEffect(() => {
    let alive = true
    if (assetId) {
      if (peekAvatarUrl(assetId)) {
        setUrl(peekAvatarUrl(assetId))
      } else {
        void getAvatarUrl(assetId).then((u) => {
          if (alive) setUrl(u)
        })
      }
    } else {
      setUrl(null)
    }
    return () => {
      alive = false
    }
  }, [assetId])

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={group ? (group.name ?? '群头像') : `${user.username} 的头像`}
        className={cn('shrink-0 select-none rounded-full object-cover shadow-sm', className)}
      />
    )
  }

  if (group) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-sm',
          className
        )}
      >
        <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="8.2" r="3.1" />
          <circle cx="16.2" cy="9.4" r="2.4" opacity="0.85" />
          <path d="M3.4 18.4c.5-3 2.9-4.8 5.6-4.8s5.1 1.8 5.6 4.8a.9.9 0 0 1-.9 1.1H4.3a.9.9 0 0 1-.9-1.1z" />
          <path d="M15.8 13.9c2 .4 3.6 1.8 4 4a.8.8 0 0 1-.8 1h-2.3c.2-1.6-.2-3.6-1.6-4.8-.4-.3 0-.2.7-.2z" opacity="0.9" />
        </svg>
      </div>
    )
  }

  const initial = Array.from(user.username.trim())[0]?.toUpperCase() ?? '?'
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm',
        className
      )}
      style={{ backgroundColor: user.avatarColor }}
    >
      {initial}
    </div>
  )
}
