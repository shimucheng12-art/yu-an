'use client'

import { cn } from '@/lib/utils'

interface Props {
  user: { username: string; avatarColor: string }
  className?: string
}

/** 用用户名首字符 + 专属颜色生成头像 */
export function UserAvatar({ user, className }: Props) {
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
