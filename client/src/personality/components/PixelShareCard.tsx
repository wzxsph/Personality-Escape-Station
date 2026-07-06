import { QRCodeSVG } from 'qrcode.react'
import type { CSSProperties } from 'react'
import type { ArchetypeResult } from '../data/types'
import { PixelSoul } from './PixelSoul'
import styles from './PixelShareCard.module.css'

interface PixelShareCardProps {
  result: ArchetypeResult
  shareUrl: string
}

export function PixelShareCard({ result, shareUrl }: PixelShareCardProps) {
  const cardStyle = {
    '--card-primary': result.scene.colors.primary,
    '--card-secondary': result.scene.colors.secondary,
    '--card-accent': result.scene.colors.accent,
    '--card-soft': result.scene.colors.soft,
  } as CSSProperties

  return (
    <article className={styles.card} style={cardStyle} aria-label={`${result.name} 分享卡`}>
      <header className={styles.header}>
        <span>人格出逃空间站</span>
        <span>PIXEL FAREWELL CARD</span>
      </header>
      <section className={styles.stage}>
        <div className={styles.stars} aria-hidden="true" />
        <PixelSoul primary={result.scene.colors.primary} accent={result.scene.colors.accent} mood="cosmic" />
      </section>
      <section className={styles.identity}>
        <p>我的人格空间</p>
        <h2>{result.name}</h2>
        <strong>{result.englishName}</strong>
      </section>
      <p className={styles.signature}>{result.scene.signature}</p>
      <div className={styles.sceneRow}>
        <span>{result.label}</span>
        <span>{result.scene.title}</span>
      </div>
      <div className={styles.footer}>
        <span>我生成了「{result.scene.title}」。你也来生成你的人格空间。</span>
        <div className={styles.qrSlot} aria-label="扫码生成你的人格空间">
          <QRCodeSVG value={shareUrl} size={56} bgColor="#ffffff" fgColor="#05070d" level="M" />
        </div>
      </div>
    </article>
  )
}