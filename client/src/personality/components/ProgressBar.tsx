import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  current: number
  total: number
}

export function ProgressBar({ current, total }: ProgressBarProps) {
  const percent = Math.round((current / total) * 100)

  return (
    <div className={styles.wrap} aria-label={`答题进度 ${current}/${total}`}>
      <div className={styles.meta}>
        <span>{String(current).padStart(2, '0')}</span>
        <span>{percent}%</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}