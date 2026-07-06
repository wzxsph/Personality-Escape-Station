import { useMemo } from 'react'
import type { BroadcastMessage } from '../data/types'
import styles from './WorldBroadcast.module.css'

interface WorldBroadcastProps {
  messages: BroadcastMessage[]
}

export default function WorldBroadcast({ messages }: WorldBroadcastProps) {
  // 计算动画持续时间：每条消息约4秒
  const duration = useMemo(() => {
    if (!messages || messages.length === 0) return 0
    return Math.max(messages.length * 4, 12)
  }, [messages])

  if (!messages || messages.length === 0) return null

  // 复制一份消息实现无缝循环
  const doubled = [...messages, ...messages]

  return (
    <div className={styles.container}>
      <div
        className={styles.track}
        style={{ '--broadcast-duration': `${duration}s` } as React.CSSProperties}
      >
        {doubled.map((msg, idx) => (
          <span key={`${msg.id}-${idx}`} className={styles.message}>
            {msg.text}
          </span>
        ))}
      </div>
    </div>
  )
}
