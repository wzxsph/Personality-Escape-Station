import { QRCodeCanvas } from 'qrcode.react'
import type { CSSProperties } from 'react'
import type { ArchetypeResult } from '../data/types'
import { PersonaSceneArt } from './PersonaSceneArt'
import styles from './PersonaPoster.module.css'

interface PersonaPosterProps {
  result: ArchetypeResult
  shareUrl: string
  shareTitle?: string
  shareSubtitle?: string
}


export function PersonaPoster({ result, shareUrl, shareTitle, shareSubtitle }: PersonaPosterProps) {
  const posterStyle = {
    '--poster-primary': result.scene.colors.primary,
    '--poster-secondary': result.scene.colors.secondary,
    '--poster-accent': result.scene.colors.accent,
    '--poster-soft': result.scene.colors.soft,
  } as CSSProperties

  return (
    <article className={styles.poster} style={posterStyle} aria-label={`${result.name} 分享海报`}>
      <header className={styles.header}>
        <span>人格出逃空间站</span>
        <span>ESCAPE POSTER</span>
      </header>

      <section className={styles.hero}>
        <PersonaSceneArt result={result} variant="poster" />
        <div className={styles.sceneTag}>{result.scene.title}</div>
      </section>

      <section className={styles.identity}>
        <p>我的逃离人格</p>
        <h1>{result.name}</h1>
        <strong>{result.englishName}</strong>
      </section>

      <p className={styles.line}>{result.tagline}</p>

      <footer className={styles.footer}>
        <div>
          <strong>{shareTitle ?? '扫码生成你的逃离人格'}</strong>
          <span>{shareSubtitle ?? '进入专属精神空间'}</span>
        </div>
        <div className={styles.qr} aria-label="扫码生成你的逃离人格">
          <QRCodeCanvas value={shareUrl} size={78} bgColor="#ffffff" fgColor="#05070d" level="M" />
        </div>
      </footer>
    </article>
  )
}
