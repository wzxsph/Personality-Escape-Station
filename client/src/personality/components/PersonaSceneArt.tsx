import type { CSSProperties } from 'react'
import type { ArchetypeResult } from '../data/types'
import styles from './PersonaSceneArt.module.css'

interface PersonaSceneArtProps {
  result: ArchetypeResult
  variant?: 'card' | 'space' | 'poster'
}


export function PersonaSceneArt({ result, variant = 'space' }: PersonaSceneArtProps) {
  const visual = result.scene.visual
  const artStyle = {
    '--art-primary': result.scene.colors.primary,
    '--art-secondary': result.scene.colors.secondary,
    '--art-accent': result.scene.colors.accent,
    '--art-soft': result.scene.colors.soft,
  } as CSSProperties

  return (
    <div
      className={`${styles.art} ${styles[variant]}`}
      data-theme={visual.theme}
      data-motion={visual.motion}
      style={artStyle}
      aria-label={`${result.scene.title} 视觉场景`}
    >
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.wall} aria-hidden="true">
        <div className={styles.window}><span /><span /></div>
        <div className={styles.lightBeam} />
      </div>
      <div className={styles.floor} aria-hidden="true" />
      <div className={styles.mainObject} aria-hidden="true"><span /><span /></div>
      <div className={styles.sideObject} aria-hidden="true"><span /></div>
      <div className={styles.signalObject} aria-hidden="true"><span /><span /><span /></div>
      <div className={styles.softNest} aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <div className={styles.inspectorWall} aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <div className={styles.glitchPortal} aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <div className={styles.character} aria-hidden="true">
        <div className={styles.characterHalo} />
        <div className={styles.characterHead}><span /><span /></div>
        <div className={styles.characterBody} />
        <div className={styles.characterShadow} />
      </div>
      <div className={styles.particles} aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <div className={styles.foreground} aria-hidden="true" />
    </div>
  )
}