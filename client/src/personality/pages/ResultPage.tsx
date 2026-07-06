import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { toPng } from 'html-to-image'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { PersonaPoster } from '../components/PersonaPoster'
import { PersonaSceneArt } from '../components/PersonaSceneArt'
import { getOfflineLiteWorldLabel, isOfflineLite, onlineFullAppUrl } from '../config/appVariant'
import { offlineLiteWorldIds } from '../config/variantShared'
import { resultsById } from '../data/results'
import { questions } from '../data/questions'
import { scoreAnswers } from '../lib/scoring'
import { getShareUrl } from '../lib/share'
import { useQuizStore } from '../store/quizStore'
import styles from './ResultPage.module.css'

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })

export function ResultPage() {
  const navigate = useNavigate()
  const answers = useQuizStore((state) => state.answers)
  const shareCardRef = useRef<HTMLDivElement>(null)
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [isPreparingShareCard, setIsPreparingShareCard] = useState(false)
  const score = useMemo(() => scoreAnswers(answers), [answers])
  const result = resultsById[score.winner]
  const shareUrl = isOfflineLite ? onlineFullAppUrl : getShareUrl()
  const offlineWorldSummary = useMemo(
    () => offlineLiteWorldIds.map((worldId) => getOfflineLiteWorldLabel(worldId)).join(' / '),
    [],
  )
  const isComplete = answers.length === questions.length
  const sceneStyle = {
    '--scene-primary': result.scene.colors.primary,
    '--scene-accent': result.scene.colors.accent,
  } as CSSProperties

  const enterSpace = () => {
    navigate('/space')
  }

  const generateShareCard = async () => {
    setExportState('exporting')
    setPreviewImage(null)
    setIsPreparingShareCard(true)

    try {
      await waitForPaint()

      const shareCard = shareCardRef.current
      if (!shareCard) {
        throw new Error('Share card is not ready')
      }

      const dataUrl = await toPng(shareCard, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: result.scene.colors.soft,
        width: shareCard.offsetWidth,
        height: shareCard.offsetHeight,
      })
      setPreviewImage(dataUrl)
      setExportState('done')
    } catch {
      setExportState('error')
    } finally {
      setIsPreparingShareCard(false)
    }
  }

  const downloadPreview = () => {
    if (!previewImage) {
      return
    }

    const link = document.createElement('a')
    link.download = `人格出逃空间站-${result.name}.png`
    link.href = previewImage
    link.click()
  }

  if (!isComplete) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyState}>
          <h1>你的逃离空间还没成形</h1>
          <p>先把 10 道选择题答完，身份卡才会出现。</p>
          <button type="button" onClick={() => navigate('/quiz')}>继续答题</button>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <article className={styles.result} style={sceneStyle}>
        <section className={styles.resultCard} aria-label={`${result.name} 逃离身份卡`}>
          <header className={styles.cardHeader}>
            <span>人格出逃空间站</span>
            <span>逃离身份已生成</span>
          </header>
          <div className={styles.cardStage}>
            <div className={styles.roomBadge}>{result.scene.title}</div>
            <PersonaSceneArt result={result} variant="card" />
          </div>
          <div className={styles.identityBlock}>
            <p>你的逃离人格</p>
            <h1>{result.name}</h1>
            <strong>{result.englishName}</strong>
          </div>
          <p className={styles.quote}>{result.scene.signature}</p>
          <div className={styles.quickStory} aria-label="人格速写">
            <span>人格速写</span>
            <p>{result.story.roast}</p>
            <p>{result.story.resonance}</p>
            <p>{result.story.gentle}</p>
          </div>
          <div className={styles.matchStrip} aria-label="匹配信息">
            <span>逃离匹配 {score.primaryMatchRate}%</span>
            <span>{result.label}</span>
          </div>
        </section>
        {isPreparingShareCard && (
          <div className={styles.captureLayer} aria-hidden="true">
            <div ref={shareCardRef} className={styles.posterCapture}>
              <PersonaPoster
                result={result}
                shareUrl={shareUrl}
                shareTitle={isOfflineLite ? '扫码进入完整版线上站' : undefined}
                shareSubtitle={isOfflineLite ? '离线轻量版仅保留 2 个代表世界' : undefined}
              />
            </div>
          </div>
        )}
        <div className={styles.primaryActions}>
          <button
            className={styles.primaryAction}
            type="button"
            onClick={() => void generateShareCard()}
            disabled={exportState === 'exporting'}
          >
            <strong>{exportState === 'exporting' ? '生成中...' : '保存图片分享'}</strong>
            <span>生成带二维码的身份卡，长按保存后发给朋友</span>
          </button>
          <button className={styles.spaceAction} type="button" onClick={enterSpace}>
            <strong>进入我的空间</strong>
            <span>看看这个人格会住进什么样的精神世界</span>
          </button>
        </div>
        {isOfflineLite && (
          <section className={styles.onlineEntryCard}>
            <div className={styles.onlineEntryQr}>
              <QRCodeSVG value={onlineFullAppUrl} size={88} bgColor="#ffffff" fgColor="#05070d" level="M" />
            </div>
            <div className={styles.onlineEntryCopy}>
              <strong>这是离线轻量版</strong>
              <span>当前只保留 {offlineWorldSummary} 2 个代表世界，完整线上版请扫码进入。</span>
              <code>{onlineFullAppUrl}</code>
            </div>
          </section>
        )}
        {exportState === 'done' && <p className={styles.status}>身份卡已生成，长按图片保存或下载后分享。</p>}
        {exportState === 'error' && <p className={styles.status}>这次导出没成功，换个浏览器或再点一次试试。</p>}
        {previewImage && (
          <div className={styles.previewOverlay} role="dialog" aria-modal="true" aria-label="分享图预览">
            <div className={styles.previewPanel}>
              <img src={previewImage} alt={`${result.name} 分享图`} />
              <p>长按图片保存，或下载后发给朋友。二维码只在这张图里出现。</p>
              <div className={styles.previewActions}>
                <button type="button" onClick={downloadPreview}>下载图片</button>
                <button type="button" onClick={() => setPreviewImage(null)}>关闭</button>
              </div>
            </div>
          </div>
        )}
      </article>
    </main>
  )
}
