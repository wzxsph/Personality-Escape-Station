import { useRef } from 'react'
import type { PersonaFragment } from '../data/types'
import styles from './EscapeCertificate.module.css'

interface EscapeCertificateProps {
  worldTitle: string
  escapeTitle: string
  escapeSubtitle: string
  fragments: PersonaFragment[]
  onClose: () => void
  onShare: () => void
}

function formatDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function EscapeCertificate({
  worldTitle,
  escapeTitle,
  escapeSubtitle,
  fragments,
  onClose,
  onShare,
}: EscapeCertificateProps) {
  const certRef = useRef<HTMLDivElement>(null)
  const sortedFragments = [...fragments].sort((a, b) => a.order - b.order)

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.certificate} ref={certRef} onClick={(e) => e.stopPropagation()}>
        {/* 标题 */}
        <h1 className={styles.heading}>✦ 出逃认证 ✦</h1>
        <p className={styles.worldName}>{escapeTitle || worldTitle}</p>
        <p className={styles.subtitle}>{escapeSubtitle}</p>

        {/* 碎片列表 */}
        <div className={styles.fragmentList}>
          {sortedFragments.map((fragment) => (
            <div key={fragment.id} className={styles.fragmentItem}>
              <p className={styles.fragmentTitle}>{fragment.title}</p>
              <p className={styles.fragmentContent}>{fragment.content}</p>
            </div>
          ))}
        </div>

        {/* 时间戳 */}
        <p className={styles.timestamp}>认证时间: {formatDate()}</p>

        {/* 操作按钮 */}
        <div className={styles.actions}>
          <button className={styles.shareBtn} onClick={onShare}>分享证书</button>
          <button className={styles.closeBtn} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
