import type { CSSProperties } from 'react'
import styles from './PixelSoul.module.css'

interface PixelSoulProps {
  primary?: string
  accent?: string
  mood?: 'idle' | 'joy' | 'cosmic'
}

export function PixelSoul({ primary = '#f4c542', accent = '#54d6bb', mood = 'idle' }: PixelSoulProps) {
  const soulStyle = {
    '--soul-primary': primary,
    '--soul-accent': accent,
  } as CSSProperties

  return (
    <div className={styles.wrap} style={soulStyle} data-mood={mood}>
      <div className={styles.halo} />
      <div className={styles.head}>
        <span />
        <span />
      </div>
      <div className={styles.body} />
      <div className={styles.shadow} />
    </div>
  )
}