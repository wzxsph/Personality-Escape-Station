import type { PersonaFragment } from '../data/types'
import { FragmentCard } from './FragmentCard'
import styles from './FragmentWall.module.css'

interface FragmentWallProps {
  worldId: string
  worldTitle: string
  fragments: PersonaFragment[]
  collectedIds: string[]
  onClose: () => void
  onGenerateCertificate: () => void
}

export function FragmentWall({
  worldTitle,
  fragments,
  collectedIds,
  onClose,
  onGenerateCertificate,
}: FragmentWallProps) {
  const total = fragments.length
  const collected = collectedIds.length
  const percent = total > 0 ? Math.round((collected / total) * 100) : 0
  const isComplete = collected >= total && total > 0

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        {/* 顶栏 */}
        <div className={styles.header}>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
          <h2 className={styles.worldTitle}>{worldTitle}</h2>
        </div>

        {/* 进度条 */}
        <div className={styles.progress}>
          <div className={styles.progressInfo}>
            <span>{collected}/{total} 碎片已收集</span>
            <span>{percent}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        </div>

        {/* 碎片卡片网格 */}
        <div className={styles.grid}>
          {fragments
            .sort((a, b) => a.order - b.order)
            .map((fragment) => (
              <FragmentCard
                key={fragment.id}
                fragment={fragment}
                isCollected={collectedIds.includes(fragment.id)}
              />
            ))}
        </div>

        {/* 底部按钮 */}
        {isComplete && (
          <div className={styles.footer}>
            <button className={styles.generateBtn} onClick={onGenerateCertificate}>
              🎉 生成出逃认证
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
