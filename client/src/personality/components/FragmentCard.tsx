import type { PersonaFragment } from '../data/types'
import styles from './FragmentCard.module.css'

interface FragmentCardProps {
  fragment: PersonaFragment
  isCollected: boolean
  onClick?: () => void
}

export function FragmentCard({ fragment, isCollected, onClick }: FragmentCardProps) {
  const cardClass = [
    styles.card,
    isCollected ? styles.collected : styles.locked,
  ].join(' ')

  return (
    <div className={cardClass} onClick={isCollected ? onClick : undefined}>
      {isCollected ? (
        <>
          <p className={styles.title}>{fragment.title}</p>
          <p className={styles.content}>{fragment.content}</p>
        </>
      ) : (
        <>
          <div className={styles.lockIcon}>🔒</div>
          <p className={styles.placeholder}>???</p>
        </>
      )}
    </div>
  )
}
