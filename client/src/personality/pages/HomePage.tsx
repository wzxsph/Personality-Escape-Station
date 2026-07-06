import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { getOfflineLiteWorldLabel, isOfflineLite, offlineLiteWorldIds, onlineFullAppUrl } from '../config/appVariant'
import { PixelSoul } from '../components/PixelSoul'
import { useQuizStore } from '../store/quizStore'
import styles from './HomePage.module.css'

export function HomePage() {
  const navigate = useNavigate()
  const resetQuiz = useQuizStore((state) => state.resetQuiz)
  const offlineWorldSummary = offlineLiteWorldIds.map((worldId) => getOfflineLiteWorldLabel(worldId)).join(' / ')

  const startQuiz = () => {
    resetQuiz()
    navigate('/quiz')
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.pixelStage} aria-hidden="true">
          <PixelSoul mood="joy" />
        </div>
        <p className={styles.eyebrow}>PERSONA ESCAPE STATION</p>
        <h1>人格出逃空间站</h1>
        <p className={styles.copy}>总有一刻，你想短暂断开。答完 10 道逃离题，生成你的逃离人格和专属精神空间。</p>
        <div className={styles.toneGrid} aria-label="测试调性">
          <span>生成身份</span>
          <span>进入空间</span>
          <span>彩蛋互动</span>
        </div>
        <button className={styles.primaryButton} type="button" onClick={startQuiz}>
          开始生成我的逃离人格
        </button>
        <p className={styles.shareHint}>结果会变成一张可保存的身份卡，也会开启你的竖屏像素空间。</p>
        {isOfflineLite && (
          <section className={styles.onlineVersionCard}>
            <div className={styles.onlineVersionQr}>
              <QRCodeSVG value={onlineFullAppUrl} size={88} bgColor="#ffffff" fgColor="#05070d" level="M" />
            </div>
            <div className={styles.onlineVersionCopy}>
              <strong>离线轻量版已启用</strong>
              <span>当前仅保留 {offlineWorldSummary} 2 个代表世界，扫码可进入完整版线上站。</span>
              <code>{onlineFullAppUrl}</code>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}
