import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DialoguePanel from '../components/DialoguePanel'
import { EscapeCertificate } from '../components/EscapeCertificate'
import { FragmentWall } from '../components/FragmentWall'
import { NativeWorldStage, type NativeWorldStageHandle } from '../components/NativeWorldStage'
import WorldBroadcast from '../components/WorldBroadcast'
import { getOfflineLiteWorldLabel, isOfflineLite, onlineFullAppUrl } from '../config/appVariant'
import type { PersonalityAssetManifest } from '../data/assetManifest'
import { resultsById } from '../data/results'
import type { ArchetypeId } from '../data/types'
import { worldConfigs, type WorldHotspot } from '../data/worlds'
import { questions } from '../data/questions'
import { applyPersonalityAssetManifest, loadPersonalityAssetManifest } from '../lib/assetManifest'
import { scoreAnswers } from '../lib/scoring'
import { copyToClipboard, getWorldInviteUrl, shareLink } from '../lib/share'
import { getFallbackVisitWorldId, isArchetypeId, resolvePlayableWorldId } from '../lib/worlds'
import { useFragmentStore } from '../store/fragmentStore'
import { useQuizStore } from '../store/quizStore'
import styles from './SpacePage.module.css'

const EMPTY_ARRAY: string[] = []

export function SpacePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const answers = useQuizStore((state) => state.answers)
  const resetQuiz = useQuizStore((state) => state.resetQuiz)
  const score = useMemo(() => scoreAnswers(answers), [answers])
  const personaResult = resultsById[score.winner]
  const isComplete = answers.length === questions.length
  const myWorldId = useMemo(() => resolvePlayableWorldId(score.winner, answers), [answers, score.winner])
  const requestedVisitId = searchParams.get('visit')
  const normalizedVisitWorldId =
    isArchetypeId(requestedVisitId) ? resolvePlayableWorldId(requestedVisitId, answers) : undefined
  const hasValidVisit = Boolean(normalizedVisitWorldId) && normalizedVisitWorldId !== myWorldId
  const sharedVisitWorldId = hasValidVisit ? normalizedVisitWorldId : undefined
  const fallbackVisitWorldId = useMemo(() => getFallbackVisitWorldId(myWorldId), [myWorldId])
  const visitWorldId = sharedVisitWorldId ?? fallbackVisitWorldId
  const visitOwner = sharedVisitWorldId ? searchParams.get('owner')?.trim() || '你的朋友' : '另一位来访者'
  const [activeView, setActiveView] = useState<'mine' | 'visit'>('mine')
  const [panelMode, setPanelMode] = useState<'world' | 'hotspot'>('world')
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null)
  const [nearbyHotspot, setNearbyHotspot] = useState<WorldHotspot | null>(null)
  const [, setStatusText] = useState('拖动左下角虚拟摇杆移动，靠近对象后再触发互动。')
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'copied' | 'error'>('idle')
  const [showFragmentWall, setShowFragmentWall] = useState(false)
  const [showCertificate, setShowCertificate] = useState(false)
  const [showWorldCard, setShowWorldCard] = useState(false)
  const [assetManifestById, setAssetManifestById] = useState<Partial<Record<ArchetypeId, PersonalityAssetManifest | null>>>({})
  const stageRef = useRef<NativeWorldStageHandle | null>(null)
  const inviteUrl = useMemo(() => {
    if (isOfflineLite) {
      return onlineFullAppUrl
    }

    return getWorldInviteUrl({ visit: myWorldId, owner: personaResult.name })
  }, [isOfflineLite, myWorldId, personaResult.name])

  // Fragment store
  const fragmentStore = useFragmentStore()

  useEffect(() => {
    setActiveView(sharedVisitWorldId ? 'visit' : 'mine')
  }, [sharedVisitWorldId])

  const activeWorldId = activeView === 'visit' && visitWorldId ? visitWorldId : myWorldId

  useEffect(() => {
    if (assetManifestById[activeWorldId] !== undefined) {
      return
    }

    let isCancelled = false
    void loadPersonalityAssetManifest(activeWorldId)
      .then((manifest) => {
        if (isCancelled) {
          return
        }
        setAssetManifestById((current) => ({ ...current, [activeWorldId]: manifest }))
      })
      .catch((error) => {
        console.warn(`Generated asset manifest unavailable for ${activeWorldId}:`, error)
        if (!isCancelled) {
          setAssetManifestById((current) => ({ ...current, [activeWorldId]: null }))
        }
      })

    return () => {
      isCancelled = true
    }
  }, [activeWorldId, assetManifestById])

  const activeWorld = useMemo(() => {
    const world = worldConfigs[activeWorldId]
    const worldWithGeneratedAssets = applyPersonalityAssetManifest(world, assetManifestById[activeWorldId])
    if (!isOfflineLite) {
      return worldWithGeneratedAssets
    }

    return {
      ...worldWithGeneratedAssets,
      assets: worldWithGeneratedAssets.assets?.backgroundImage
        ? {
            backgroundImage: worldWithGeneratedAssets.assets.backgroundImage,
          }
        : undefined,
    }
  }, [activeWorldId, assetManifestById, isOfflineLite])
  const worldPersona = resultsById[activeWorldId]
  const sceneStyle = {
    '--space-primary': worldPersona.scene.colors.primary,
    '--space-secondary': worldPersona.scene.colors.secondary,
    '--space-accent': worldPersona.scene.colors.accent,
    '--space-soft': worldPersona.scene.colors.soft,
  } as CSSProperties

  // 世界切换时重置面板状态
  useEffect(() => {
    setPanelMode('world')
    setActiveHotspotId(null)
    setNearbyHotspot(null)
    setShowFragmentWall(false)
    setShowCertificate(false)
    setShowWorldCard(false)
    setStatusText(`已进入 ${activeWorld.title}。${activeWorld.mission}`)
  }, [activeWorld])

  useEffect(() => {
    if (shareState === 'idle') {
      return
    }

    const timeout = window.setTimeout(() => setShareState('idle'), 2600)
    return () => window.clearTimeout(timeout)
  }, [shareState])

  const startAgain = () => {
    resetQuiz()
    navigate('/quiz')
  }

  const worldHotspots = activeWorld.hotspots
  const activeHotspot = useMemo(
    () => worldHotspots.find((item) => item.id === activeHotspotId) ?? null,
    [activeHotspotId, worldHotspots],
  )

  // 查找当前 hotspot 关联的碎片
  const activeFragment = useMemo(() => {
    if (!activeHotspot?.fragmentId) return undefined
    return activeWorld.fragments?.find((f) => f.id === activeHotspot.fragmentId)
  }, [activeHotspot, activeWorld.fragments])

  // 已收集碎片的ID列表
  const collectedIds = fragmentStore.collected[activeWorldId] ?? EMPTY_ARRAY

  // 根据碎片找到已完成的 hotspot IDs
  const completedHotspotIds = useMemo(() => {
    const fragments = activeWorld.fragments ?? []
    return fragments
      .filter((f) => collectedIds.includes(f.id))
      .map((f) => f.hotspotId)
  }, [activeWorld.fragments, collectedIds])

  // 已收集碎片的完整数据（用于证书）
  const collectedFragmentDetails = useMemo(() => {
    const fragments = activeWorld.fragments ?? []
    return fragments.filter((f) => collectedIds.includes(f.id))
  }, [activeWorld.fragments, collectedIds])

  const openHotspot = useCallback((hotspot: WorldHotspot) => {
    setPanelMode('hotspot')
    setActiveHotspotId(hotspot.id)
    setStatusText(hotspot.reaction)
  }, [])

  const handleNearbyHotspotChange = useCallback((hotspot: WorldHotspot | null) => {
    setNearbyHotspot(hotspot)
  }, [])

  const handleHotspotInteract = useCallback((hotspot: WorldHotspot) => {
    // 对话冷却控制
    if (fragmentStore.isCoolingDown(hotspot.id)) {
      setStatusText('稍后再试')
      return
    }
    openHotspot(hotspot)
  }, [openHotspot, fragmentStore])

  const handlePrimaryAction = () => {
    if (!nearbyHotspot) {
      setPanelMode('world')
      setActiveHotspotId(null)
      setStatusText('再靠近一点，角色才能和场景里的对象发生联系。')
      return
    }
    // 对话冷却控制
    if (fragmentStore.isCoolingDown(nearbyHotspot.id)) {
      setStatusText('稍后再试')
      return
    }
    stageRef.current?.triggerPrimaryAction()
  }

  const handleSecondaryAction = () => {
    setShowWorldCard(true)
    setPanelMode('world')
    setActiveHotspotId(null)
  }

  const handleCloseDialogue = useCallback(() => {
    if (activeHotspot) {
      fragmentStore.setCooldown(activeHotspot.id)
    }
    setPanelMode('world')
    setActiveHotspotId(null)
    setStatusText(activeWorld.mission)
  }, [activeHotspot, activeWorld.mission, fragmentStore])

  const handleFragmentCollected = useCallback((fragmentId: string) => {
    fragmentStore.addFragment(activeWorldId, fragmentId)
  }, [activeWorldId, fragmentStore])

  const handleShareWorld = async () => {
    try {
      const shareText = isOfflineLite
        ? '离线轻量版仅保留 2 个代表世界，扫码进入完整版体验全部世界。'
        : `${resultsById[myWorldId].shareLine} 来我的世界串门。`
      const mode = await shareLink(shareText, inviteUrl)
      setShareState(mode)
      setStatusText(
        mode === 'shared'
          ? '已经调起系统分享。'
          : isOfflineLite
            ? '完整版入口已复制，可以发给朋友了。'
            : '邀请链接已复制，可以发给朋友了。',
      )
    } catch {
      setShareState('error')
      setStatusText('这次分享没有成功，稍后再试一次。')
    }
  }

  const handleCopyInvite = async () => {
    try {
      await copyToClipboard(inviteUrl)
      setShareState('copied')
      setStatusText(
        isOfflineLite ? '完整版入口已复制，现在可以发给朋友扫码或直接打开。' : '邀请链接已复制，现在可以发给朋友扫码或直接打开。',
      )
    } catch {
      setShareState('error')
      setStatusText('复制邀请链接失败，请稍后再试。')
    }
  }

  const handleShareCertificate = () => {
    void handleShareWorld()
  }

  if (!isComplete) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyPanel}>
          <h1>空间还没搭好</h1>
          <p>先完成 10 道题，系统才知道该给你分配哪一种逃离空间。</p>
          <button type="button" onClick={() => navigate('/quiz')}>继续答题</button>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.page} style={sceneStyle}>
      <article className={styles.spaceShell}>
        <header className={styles.topBar}>
          <div>
            <p className={styles.eyebrow}>ESCAPE SPACE</p>
            <h1>{activeWorld.title}</h1>
            <p>
              {activeView === 'visit' && visitWorldId !== myWorldId
                ? `正在以 ${personaResult.name} 身份访问 ${visitOwner} 的人格世界`
                : `你当前的世界人格是 ${worldPersona.name}`}
            </p>
          </div>
          <div className={styles.topActions}>
            {visitWorldId !== myWorldId && (
              <button
                type="button"
                onClick={() => setActiveView((currentView) => (currentView === 'mine' ? 'visit' : 'mine'))}
              >
                {activeView === 'mine' ? `去看 ${visitOwner} 的世界` : '返回我的世界'}
              </button>
            )}
            <button type="button" onClick={() => navigate('/result')}>身份卡</button>
            <button type="button" onClick={() => void handleShareWorld()}>分享我的世界</button>
          </div>
        </header>
        <section className={styles.room} aria-label={`${activeWorld.title} 互动空间`}>
          <div className={styles.sceneHud}>
            <span>{activeView === 'mine' ? '我的世界' : `${visitOwner} 的世界`}</span>
            <strong>{worldPersona.name}</strong>
            <span>{activeWorld.subtitle}</span>
          </div>
          <div className={styles.stageViewport}>
            <div className={styles.stage} data-theme={worldPersona.scene.visual.theme}>
              <NativeWorldStage
                ref={stageRef}
                world={activeWorld}
                visitorWorldId={myWorldId}
                completedHotspotIds={completedHotspotIds}
                onNearbyHotspotChange={handleNearbyHotspotChange}
                onHotspotInteract={handleHotspotInteract}
                onStatusChange={setStatusText}
              />
            </div>
            <WorldBroadcast messages={activeWorld?.broadcasts ?? []} />
            {/* 碎片入口按钮 */}
            {(activeWorld.fragments?.length ?? 0) > 0 && (
              <button
                type="button"
                className={styles.fragmentButton}
                onClick={() => setShowFragmentWall(true)}
              >
                📋 碎片
                <span className={styles.fragmentBadge}>{collectedIds.length}</span>
              </button>
            )}
            <div className={styles.actionDock}>
              <button type="button" className={styles.actionButton} onClick={handlePrimaryAction}>
                <strong>{nearbyHotspot ? nearbyHotspot.actionLabel : '互动'}</strong>
                <span>{nearbyHotspot ? nearbyHotspot.label : '先移动到对象附近'}</span>
              </button>
              <button type="button" className={styles.secondaryButton} onClick={handleSecondaryAction}>
                <strong>查看世界</strong>
                <span>任务 / 提示</span>
              </button>
            </div>
            {/* 对话面板 - 居中浮在stageViewport上 */}
            {panelMode === 'hotspot' && activeHotspot?.dialogue && (
              <DialoguePanel
                archetypeId={activeWorldId}
                hotspot={activeHotspot}
                fragment={activeFragment}
                onClose={handleCloseDialogue}
                onFragmentCollected={handleFragmentCollected}
                isFragmentAlreadyCollected={
                  activeHotspot.fragmentId
                    ? fragmentStore.isFragmentCollected(activeWorldId, activeHotspot.fragmentId)
                    : false
                }
              />
            )}
            {/* 世界任务卡片 - 居中浮在stageViewport上 */}
            {panelMode === 'world' && activeHotspotId === null && showWorldCard && (
              <div className={styles.worldCardOverlay} onClick={() => setShowWorldCard(false)}>
                <div className={styles.worldCard} onClick={(e) => e.stopPropagation()}>
                  <header className={styles.worldCardHeader}>
                    <span>世界任务</span>
                    <button type="button" onClick={() => setShowWorldCard(false)}>✕</button>
                  </header>
                  <h3 className={styles.worldCardTitle}>{activeWorld.title}</h3>
                  <p className={styles.worldCardDesc}>{activeWorld.atmosphere}</p>
                  <div className={styles.worldCardLines}>
                    <p>🎯 移动角色靠近场景中的 NPC 和道具，点击"互动"与它们对话</p>
                    <p>🧩 每个对象隐藏着一枚人格碎片彩蛋，说对关键词即可解锁</p>
                    <p>💡 {activeWorld.promptCue}</p>
                    <p>✨ 收集全部碎片，即可获得"出逃成功"认证</p>
                  </div>
                </div>
              </div>
            )}
          </div>


        </section>

        <section className={styles.consolePanel}>
          {panelMode === 'hotspot' && activeHotspot ? (
            activeHotspot.dialogue ? (
              null
            ) : (
              <>
                <header className={styles.panelHeader}>
                  <div>
                    <p>{activeHotspot.kind === 'npc' ? '世界居民' : '互动对象'}</p>
                    <h2>{activeHotspot.title}</h2>
                  </div>
                  <span>{activeHotspot.label}</span>
                </header>
                <p className={styles.panelSummary}>{activeHotspot.summary}</p>
                <div className={styles.panelLines}>
                  {activeHotspot.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
                <div className={styles.panelFooter}>
                  <span>{activeHotspot.reaction}</span>
                  <button type="button" onClick={handleSecondaryAction}>返回世界任务</button>
                </div>
              </>
            )
          ) : (
            <div className={styles.panelLines}>
              <p>🎯 移动角色，靠近 NPC 或道具后点击"互动"发起对话</p>
              <p>🧩 对话中说出关键词，即可解锁隐藏的人格碎片彩蛋</p>
              <p>✨ 收集所有碎片 → 获得"出逃成功"认证</p>
            </div>
          )}
          <section className={styles.sharePanel}>
            <div className={styles.shareQrCard}>
              <div
                className={styles.shareQrCode}
                aria-label={isOfflineLite ? '扫一扫进入完整版线上站' : '扫一扫进入我的人格世界'}
              >
                <QRCodeSVG value={inviteUrl} size={92} bgColor="#ffffff" fgColor="#05070d" level="M" />
              </div>
              <div className={styles.shareInfo}>
                <strong>{isOfflineLite ? '扫码进入完整版线上站' : '扫码进入我的世界'}</strong>
                <span>
                  {isOfflineLite
                    ? `离线轻量版当前保留 ${getOfflineLiteWorldLabel('BEDX')} / ${getOfflineLiteWorldLabel('SPRK')} 两个代表世界。`
                    : '朋友可直接用手机扫码进入页面；如果还没做题，会先进入测试再进入世界。'}
                </span>
                <code>{inviteUrl}</code>
              </div>
            </div>
            <div className={styles.shareActions}>
              <button type="button" onClick={() => void handleShareWorld()}>
                {isOfflineLite ? '分享完整版' : '系统分享'}
              </button>
              <button type="button" onClick={() => void handleCopyInvite()}>
                {isOfflineLite ? '复制完整版链接' : '复制链接'}
              </button>
            </div>
          </section>
        </section>
        <footer className={styles.footerBar}>
          <div className={styles.footerMeta}>
            <span>你的世界人格：{resultsById[myWorldId].name}</span>
          </div>
          <button type="button" onClick={startAgain}>重新生成</button>
        </footer>
      </article>

      {/* 碎片墙面板 */}
      {showFragmentWall && (
        <FragmentWall
          worldId={activeWorldId}
          worldTitle={activeWorld?.title ?? ''}
          fragments={activeWorld?.fragments ?? []}
          collectedIds={collectedIds}
          onClose={() => setShowFragmentWall(false)}
          onGenerateCertificate={() => {
            setShowFragmentWall(false)
            setShowCertificate(true)
          }}
        />
      )}

      {/* 出逃认证证书 */}
      {showCertificate && (
        <EscapeCertificate
          worldTitle={activeWorld?.title ?? ''}
          escapeTitle={activeWorld?.escapeTitle ?? '出逃认证'}
          escapeSubtitle={activeWorld?.escapeSubtitle ?? ''}
          fragments={collectedFragmentDetails}
          onClose={() => setShowCertificate(false)}
          onShare={handleShareCertificate}
        />
      )}
    </main>
  )
}
