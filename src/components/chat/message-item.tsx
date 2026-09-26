'use client'

import { motion } from 'framer-motion'
import { format } from 'date-fns'
import type { ChatMessage } from '@/types/chat'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/chat/user-avatar'
import { FileBubble } from '@/components/chat/file-bubble'

interface Props {
  message: ChatMessage
  isOwn: boolean
  compact: boolean
  onPreviewImage: (message: ChatMessage, url: string) => void
}

/** 单条聊天气泡：自己的消息靠右（绿色），他人靠左（灰色），连续消息紧凑排列 */
export function MessageItem({ message, isOwn, compact, onPreviewImage }: Props) {
  const time = format(new Date(message.createdAt), 'HH:mm')

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('flex w-full items-end gap-2', isOwn ? 'flex-row-reverse' : 'flex-row', compact ? 'mt-0.5' : 'mt-3')}
    >
      {compact ? (
        <div className="w-8 shrink-0" aria-hidden="true" />
      ) : (
        <UserAvatar user={message.user} className="h-8 w-8 text-sm" />
      )}

      <div className={cn('flex min-w-0 max-w-[78%] flex-col gap-1 sm:max-w-[70%]', isOwn ? 'items-end' : 'items-start')}>
        {!compact && !isOwn && (
          <span className="px-1 text-xs font-medium" style={{ color: message.user.avatarColor }}>
            {message.user.username}
          </span>
        )}
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm',
            isOwn ? 'rounded-br-md bg-emerald-600 text-white' : 'rounded-bl-md bg-muted text-foreground'
          )}
        >
          {message.type === 'file' ? (
            <FileBubble message={message} isOwn={isOwn} onPreviewImage={onPreviewImage} />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>
        <span className="px-1 text-[10px] text-muted-foreground" aria-label={`发送于 ${time}`}>
          {time}
        </span>
      </div>
    </motion.div>
  )
}
