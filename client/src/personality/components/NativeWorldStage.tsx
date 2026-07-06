import Phaser from 'phaser'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { resultsById } from '../data/results'
import type { ArchetypeId } from '../data/types'
import type { WorldConfig, WorldHotspot, WorldSpriteAsset } from '../data/worlds'
import { buildStageMap, getStagePointFromPercent, STAGE_HEIGHT, STAGE_WIDTH } from '../worldx-native/buildStageMap'
import { CharacterSprite, type SpriteSheetMeta } from '../worldx-native/CharacterSprite'
import { MapManager } from '../worldx-native/MapManager'

const assetBaseUrl = import.meta.env.BASE_URL
const INTERACTION_RADIUS_PX = 82
const JOYSTICK_RADIUS_PX = 34
const JOYSTICK_DEADZONE = 0.16
const JOYSTICK_SPEED_PX = 240
const PLAYER_COLLISION_SAMPLES = [
  { x: 0, y: 0 },
  { x: -8, y: 6 },
  { x: 8, y: 6 },
  { x: 0, y: 12 },
]

declare global {
  interface Window {
    __OFFLINE_ASSET_MAP__?: Record<string, string>
  }
}

export interface NativeWorldStageHandle {
  triggerPrimaryAction: () => void
}

interface NativeWorldStageProps {
  world: WorldConfig
  visitorWorldId: ArchetypeId
  playerSpriteOverride?: WorldSpriteAsset
  completedHotspotIds?: string[]
  onNearbyHotspotChange: (hotspot: WorldHotspot | null) => void
  onHotspotInteract: (hotspot: WorldHotspot) => void
  onStatusChange: (message: string) => void
}

interface HotspotRenderBundle {
  config: WorldHotspot
  container: Phaser.GameObjects.Container
  ring: Phaser.GameObjects.Graphics
  ringWidth: number
  ringHeight: number
}

class NativeWorldScene extends Phaser.Scene {
  private getProps: () => NativeWorldStageProps
  private mapManager = new MapManager()
  private player!: CharacterSprite
  private hotspots = new Map<string, HotspotRenderBundle>()
  private nearbyHotspotId: string | null = null
  private joystickVector = new Phaser.Math.Vector2(0, 0)
  private walkableOverlay: Phaser.GameObjects.Graphics | null = null
  private walkableOverlayVisible = false
  private isReady = false

  constructor(getProps: () => NativeWorldStageProps) {
    super('NativeWorldScene')
    this.getProps = getProps
  }

  refreshAllRings() {
    for (const hotspotId of this.hotspots.keys()) {
      this.refreshHotspotRing(hotspotId, hotspotId === this.nearbyHotspotId)
    }
  }

  setWalkableOverlayVisible(visible: boolean) {
    this.walkableOverlayVisible = visible
    if (!this.isReady) {
      return
    }
    this.drawWalkableOverlay()
  }

  preload() {
    const props = this.getProps()
    const mapTmj = props.world.assets?.mapTmj
    if (mapTmj) {
      this.load.json(this.getMapCacheKey(), resolveAssetUrl(mapTmj))
    }

    const backgroundImage = props.world.assets?.backgroundImage
    if (backgroundImage) {
      this.load.image('world-background', resolveAssetUrl(backgroundImage))
    }

    const playerSprite = props.playerSpriteOverride ?? props.world.assets?.playerSprite
    if (playerSprite) {
      this.loadSpriteAsset('player-sprite', playerSprite)
    }

    Object.entries(props.world.assets?.hotspotSprites ?? {}).forEach(([hotspotId, asset]) => {
      if (asset) {
        this.loadSpriteAsset(`hotspot-${hotspotId}`, asset)
      }
    })
  }

  create() {
    this.isReady = true
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.isReady = false
      this.walkableOverlay = null
    })
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.isReady = false
      this.walkableOverlay = null
    })
    this.cameras.main.setRoundPixels(true)
    this.createBackdrop()

    const tiledMap = this.cache.json.get(this.getMapCacheKey()) ?? buildStageMap(this.getProps().world)
    this.mapManager.loadFromTiledJSON(tiledMap)
    this.drawWalkableOverlay()

    this.createDefaultGeometry()
    this.createHotspots()
    this.createPlayer()
    this.updateNearbyHotspot(true)
  }

  update(_time: number, delta: number) {
    this.updatePlayerMovement(delta)
    this.player.depth = this.player.getSortFootY()
    this.updateNearbyHotspot(false)
  }

  setJoystickInput(x: number, y: number) {
    this.joystickVector.set(x, y)
  }

  triggerPrimaryAction() {
    const hotspot = this.getNearbyHotspot()
    if (!hotspot) {
      this.getProps().onStatusChange('再靠近一点，角色才能和场景里的对象发生联系。')
      return
    }
    this.getProps().onHotspotInteract(hotspot)
  }

  private createBackdrop() {
    if (this.textures.exists('world-background')) {
      const image = this.add.image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, 'world-background')
      const source = image.texture.getSourceImage() as { width?: number; height?: number }
      const sourceWidth = source.width ?? STAGE_WIDTH
      const sourceHeight = source.height ?? STAGE_HEIGHT
      const scale = Math.min(STAGE_WIDTH / sourceWidth, STAGE_HEIGHT / sourceHeight)
      image.setScale(scale)
      image.setDepth(-10)
      this.add.rectangle(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, STAGE_WIDTH, STAGE_HEIGHT, 0x05070d, 0.16)
      return
    }

    const palette = resultsById[this.getProps().world.id].scene.colors
    const background = this.add.graphics()
    background.fillGradientStyle(
      Phaser.Display.Color.HexStringToColor(palette.secondary).color,
      Phaser.Display.Color.HexStringToColor(palette.primary).color,
      Phaser.Display.Color.HexStringToColor(palette.soft).color,
      Phaser.Display.Color.HexStringToColor(palette.soft).color,
      1,
    )
    background.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
    background.fillStyle(0x000000, 0.18)
    for (let x = 0; x < STAGE_WIDTH; x += 24) {
      background.fillRect(x, 0, 1, STAGE_HEIGHT)
    }
    for (let y = 0; y < STAGE_HEIGHT; y += 24) {
      background.fillRect(0, y, STAGE_WIDTH, 1)
    }
  }

  private createDefaultGeometry() {
    if (this.getProps().world.assets?.backgroundImage) {
      return
    }

    const drawShape = (x: number, y: number, width: number, height: number, color: number, alpha = 0.76) => {
      const graphics = this.add.graphics()
      graphics.fillStyle(color, alpha)
      graphics.lineStyle(6, 0x05070d, 1)
      graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, 22)
      graphics.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 22)
      return graphics
    }

    this.getProps().world.decorations.forEach((item) => {
      const pixelRect = getStageRect(item.x, item.y, item.width, item.height)
      drawShape(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height, 0xffffff, item.depth === 'rear' ? 0.1 : 0.16)
      const text = this.add.text(pixelRect.x - pixelRect.width / 2 + 14, pixelRect.y - pixelRect.height / 2 + 12, item.label, {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#10131d',
      })
      text.setAlpha(0.64)
    })

    const landmark = this.getProps().world.landmark
    const landmarkRect = getStageRect(landmark.x, landmark.y, landmark.width, landmark.height)
    drawShape(landmarkRect.x, landmarkRect.y, landmarkRect.width, landmarkRect.height, 0xffffff, 0.82)
    this.add.text(landmarkRect.x - landmarkRect.width / 2 + 18, landmarkRect.y - 10, landmark.label, {
      fontFamily: 'Arial',
      fontSize: '28px',
      fontStyle: 'bold',
      color: '#05070d',
    })
  }

  private createHotspots() {
    const props = this.getProps()
    props.world.hotspots.forEach((hotspot) => {
      const point = this.mapManager.getObjectRenderPosition(hotspot.id) ?? getStagePointFromPercent(hotspot.x, hotspot.y)
      const ring = this.add.graphics()
      const label = this.add.text(0, 72, hotspot.label, {
        fontFamily: 'Arial',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        align: 'center',
      }).setOrigin(0.5, 0)

      const spriteAsset = props.world.assets?.hotspotSprites?.[hotspot.id]
      const displayObject = spriteAsset
        ? this.createSpriteDisplay(`hotspot-${hotspot.id}`, spriteAsset, hotspot.kind === 'npc' ? 0.86 : 0.9)
        : this.createFallbackHotspot(hotspot)
      const displayMetrics = getDisplayMetrics(spriteAsset)
      const ringWidth = Math.max(136, Math.ceil(displayMetrics.width + 56))
      const ringHeight = Math.max(136, Math.ceil(displayMetrics.height + 40))
      const hitWidth = Math.max(160, Math.ceil(displayMetrics.width + 72))
      const hitHeight = Math.max(182, Math.ceil(displayMetrics.height + 96))

      const container = this.add.container(point.x, point.y, [ring, displayObject, label])
      container.setSize(hitWidth, hitHeight)
      container.setDepth(point.y)
      container.setInteractive(
        new Phaser.Geom.Rectangle(-hitWidth / 2, -hitHeight + 52, hitWidth, hitHeight),
        Phaser.Geom.Rectangle.Contains,
      )
      container.on('pointerdown', () => {
        if (this.nearbyHotspotId === hotspot.id) {
          this.getProps().onHotspotInteract(hotspot)
          return
        }
        this.getProps().onStatusChange(`先用摇杆靠近 ${hotspot.label}，再触发互动。`)
      })

      this.hotspots.set(hotspot.id, { config: hotspot, container, ring, ringWidth, ringHeight })
      this.refreshHotspotRing(hotspot.id, false)
    })
  }

  private createPlayer() {
    const props = this.getProps()
    const spawn = props.world.generatedAssets?.spawn ?? getStagePointFromPercent(props.world.spawn.x, props.world.spawn.y)
    const playerSprite = props.playerSpriteOverride ?? props.world.assets?.playerSprite
    this.player = new CharacterSprite(
      this,
      spawn.x,
      spawn.y,
      Phaser.Display.Color.HexStringToColor(resultsById[props.visitorWorldId].scene.colors.primary).color,
      playerSprite ? buildSpriteMeta('player-sprite', playerSprite) : undefined,
    )
    this.player.depth = this.player.getSortFootY()
  }

  private createFallbackHotspot(hotspot: WorldHotspot) {
    const graphics = this.add.graphics()
    const worldId = this.getProps().world.id
    const accent =
      hotspot.accent === 'primary'
        ? Phaser.Display.Color.HexStringToColor(resultsById[worldId].scene.colors.primary).color
        : hotspot.accent === 'secondary'
          ? Phaser.Display.Color.HexStringToColor(resultsById[worldId].scene.colors.secondary).color
          : Phaser.Display.Color.HexStringToColor(resultsById[worldId].scene.colors.accent).color
    graphics.fillStyle(accent, 0.94)
    graphics.lineStyle(6, 0x05070d, 1)
    graphics.fillRoundedRect(-42, -48, 84, 84, hotspot.kind === 'npc' ? 22 : 14)
    graphics.strokeRoundedRect(-42, -48, 84, 84, hotspot.kind === 'npc' ? 22 : 14)
    const icon = this.add.text(0, -5, hotspot.icon, {
      fontFamily: 'Arial',
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#05070d',
    }).setOrigin(0.5)
    return this.add.container(0, 0, [graphics, icon])
  }

  private createSpriteDisplay(textureKey: string, asset: WorldSpriteAsset, originY: number) {
    const idleFrame = asset.animations?.idleFront ?? asset.frameIndex
    const sprite = asset.sourceType === 'image'
      ? this.add.sprite(0, 0, textureKey)
      : asset.sourceType === 'frames'
        ? this.add.sprite(0, 0, buildFrameTextureKey(textureKey, idleFrame))
        : this.add.sprite(0, 0, textureKey, idleFrame)
    sprite.setOrigin(0.5, originY)
    sprite.setScale(asset.scale)
    return sprite
  }

  private loadSpriteAsset(key: string, asset: WorldSpriteAsset) {
    if (asset.sourceType === 'frames' && asset.framesDir) {
      const frameCount = asset.frameCount ?? asset.columns * asset.rows
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        this.load.image(
          buildFrameTextureKey(key, frameIndex),
          resolveAssetUrl(`${asset.framesDir}/${buildFrameFileName(frameIndex)}`),
        )
      }
      return
    }

    if (!asset.imagePath) {
      return
    }

    if (asset.sourceType === 'image') {
      this.load.image(key, resolveAssetUrl(asset.imagePath))
      return
    }

    this.load.spritesheet(key, resolveAssetUrl(asset.imagePath), {
      frameWidth: asset.frameWidth,
      frameHeight: asset.frameHeight,
    })
  }

  private updatePlayerMovement(delta: number) {
    const magnitude = this.joystickVector.length()
    if (magnitude < JOYSTICK_DEADZONE) {
      if (this.player.isMoving) {
        this.player.stopMoving()
      }
      return
    }

    const direction = this.joystickVector.clone().normalize()
    const distance = JOYSTICK_SPEED_PX * Math.min(magnitude, 1) * (delta / 1000)
    const deltaX = direction.x * distance
    const deltaY = direction.y * distance

    let nextX = this.player.x
    let nextY = this.player.y

    if (this.canOccupy(nextX + deltaX, nextY)) {
      nextX += deltaX
    }

    if (this.canOccupy(nextX, nextY + deltaY)) {
      nextY += deltaY
    }

    const appliedX = nextX - this.player.x
    const appliedY = nextY - this.player.y

    if (Math.abs(appliedX) < 0.001 && Math.abs(appliedY) < 0.001) {
      this.player.stopMoving()
      return
    }

    this.player.moveWithVector(appliedX, appliedY)
  }

  private canOccupy(x: number, y: number) {
    return PLAYER_COLLISION_SAMPLES.every((sample) => this.mapManager.isWalkablePixel(x + sample.x, y + sample.y))
  }

  private drawWalkableOverlay() {
    if (!this.isReady || !this.add) {
      return
    }
    if (!this.walkableOverlay) {
      this.walkableOverlay = this.add.graphics()
      this.walkableOverlay.setDepth(5)
    }

    this.walkableOverlay.clear()
    this.walkableOverlay.setVisible(this.walkableOverlayVisible)
    if (!this.walkableOverlayVisible || !this.mapManager.hasWalkableData()) {
      return
    }

    this.walkableOverlay.fillStyle(0x34e8d1, 0.32)
    for (let gy = 0; gy < this.mapManager.gridHeight; gy += 1) {
      for (let gx = 0; gx < this.mapManager.gridWidth; gx += 1) {
        if (this.mapManager.isWalkable(gx, gy)) {
          this.walkableOverlay.fillRect(
            gx * this.mapManager.tileSize,
            gy * this.mapManager.tileSize,
            this.mapManager.tileSize,
            this.mapManager.tileSize,
          )
        }
      }
    }
  }

  private getNearbyHotspot() {
    let nearest: { hotspot: WorldHotspot; distance: number } | null = null
    for (const bundle of this.hotspots.values()) {
      const target = this.mapManager.getObjectInteractionPosition(bundle.config.id)
      if (!target) {
        continue
      }
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y)
      if (nearest === null || distance < nearest.distance) {
        nearest = { hotspot: bundle.config, distance }
      }
    }

    if (!nearest || nearest.distance > INTERACTION_RADIUS_PX) {
      return null
    }
    return nearest.hotspot
  }

  private updateNearbyHotspot(force: boolean) {
    const hotspot = this.getNearbyHotspot()
    const nextId = hotspot?.id ?? null
    if (!force && nextId === this.nearbyHotspotId) {
      return
    }
    this.nearbyHotspotId = nextId
    for (const hotspotId of this.hotspots.keys()) {
      this.refreshHotspotRing(hotspotId, hotspotId === nextId)
    }
    this.getProps().onNearbyHotspotChange(hotspot)
  }

  private refreshHotspotRing(hotspotId: string, active: boolean) {
    const bundle = this.hotspots.get(hotspotId)
    if (!bundle) {
      return
    }
    bundle.ring.clear()
    if (!active) {
      return
    }
    const isCompleted = this.getProps().completedHotspotIds?.includes(hotspotId) ?? false
    const ringColor = isCompleted ? 0x54d6bb : 0xffef74
    bundle.ring.lineStyle(6, ringColor, 1)
    bundle.ring.strokeRoundedRect(
      -bundle.ringWidth / 2,
      -bundle.ringHeight + 58,
      bundle.ringWidth,
      bundle.ringHeight,
      bundle.config.kind === 'npc' ? 34 : 24,
    )
  }

  private getMapCacheKey() {
    const mapTmj = this.getProps().world.assets?.mapTmj ?? 'synthetic'
    return `world-map-${this.getProps().world.id}-${hashCacheKey(mapTmj)}`
  }
}

export const NativeWorldStage = forwardRef<NativeWorldStageHandle, NativeWorldStageProps>(function NativeWorldStage(
  props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<NativeWorldScene | null>(null)
  const { world, visitorWorldId, completedHotspotIds } = props
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 })
  const [showWalkableOverlay, setShowWalkableOverlay] = useState(false)

  const propsRef = useRef(props)
  propsRef.current = props

  const getProps = useCallback(() => propsRef.current, [])

  useImperativeHandle(ref, () => ({
    triggerPrimaryAction() {
      sceneRef.current?.triggerPrimaryAction()
    },
  }), [])

  const updateJoystick = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const rawX = clientX - centerX
    const rawY = clientY - centerY
    const distance = Math.hypot(rawX, rawY)
    const ratio = distance > JOYSTICK_RADIUS_PX ? JOYSTICK_RADIUS_PX / distance : 1
    const offsetX = rawX * ratio
    const offsetY = rawY * ratio

    setJoystickOffset({ x: offsetX, y: offsetY })
    sceneRef.current?.setJoystickInput(offsetX / JOYSTICK_RADIUS_PX, offsetY / JOYSTICK_RADIUS_PX)
  }, [])

  const resetJoystick = useCallback(() => {
    setJoystickOffset({ x: 0, y: 0 })
    sceneRef.current?.setJoystickInput(0, 0)
  }, [])

  const handleJoystickPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateJoystick(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  }, [updateJoystick])

  const handleJoystickPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.buttons & 1) !== 1 && event.pointerType !== 'touch') {
      return
    }
    updateJoystick(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  }, [updateJoystick])

  const handleJoystickPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resetJoystick()
  }, [resetJoystick])

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const scene = new NativeWorldScene(getProps)
    sceneRef.current = scene

    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: hostRef.current,
      transparent: true,
      backgroundColor: '#05070d',
      scene: [scene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
      },
      render: {
        pixelArt: true,
        antialias: false,
        roundPixels: true,
      },
      input: {
        touch: {
          capture: false,
        },
      },
      audio: {
        noAudio: true,
      },
    })

    return () => {
      resetJoystick()
      sceneRef.current = null
      game.destroy(true)
    }
  }, [
    world.id,
    world.assets?.backgroundImage,
    world.assets?.mapTmj,
    world.generatedAssets?.provenance.runId,
    visitorWorldId,
    props.playerSpriteOverride,
    getProps,
    resetJoystick,
  ])

  // 当 completedHotspotIds 变化时刷新 ring 颜色（无需重建游戏）
  const completedIdsRef = useRef(completedHotspotIds)
  useEffect(() => {
    if (completedIdsRef.current !== completedHotspotIds) {
      completedIdsRef.current = completedHotspotIds
      sceneRef.current?.refreshAllRings()
    }
  })

  useEffect(() => {
    sceneRef.current?.setWalkableOverlayVisible(showWalkableOverlay)
  }, [showWalkableOverlay])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <button
        type="button"
        onClick={() => setShowWalkableOverlay((current) => !current)}
        style={{
          position: 'absolute',
          left: 14,
          top: 14,
          zIndex: 12,
          pointerEvents: 'auto',
          border: '3px solid #05070d',
          background: showWalkableOverlay ? 'var(--space-primary, #f4c542)' : 'rgba(255, 255, 255, 0.84)',
          color: '#05070d',
          boxShadow: '3px 3px 0 #05070d',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 800,
          padding: '7px 10px',
        }}
        aria-pressed={showWalkableOverlay}
      >
        可走区
      </button>
      <div
        style={{
          position: 'absolute',
          left: 14,
          bottom: 14,
          zIndex: 12,
          pointerEvents: 'auto',
        }}
      >
        <div
          onPointerDown={handleJoystickPointerDown}
          onPointerMove={handleJoystickPointerMove}
          onPointerUp={handleJoystickPointerUp}
          onPointerCancel={handleJoystickPointerUp}
          style={{
            position: 'relative',
            width: 96,
            height: 96,
            borderRadius: 999,
            border: '3px solid #05070d',
            background: 'rgba(255, 255, 255, 0.12)',
            boxShadow: '4px 4px 0 #05070d',
            touchAction: 'none',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 16,
              borderRadius: 999,
              border: '2px dashed rgba(255, 255, 255, 0.18)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 48 + joystickOffset.x - 14,
              top: 48 + joystickOffset.y - 14,
              width: 28,
              height: 28,
              borderRadius: 999,
              background: 'var(--space-primary, #f4c542)',
              border: '3px solid #05070d',
              boxShadow: '3px 3px 0 #05070d',
            }}
          />
        </div>
      </div>
    </div>
  )
})

function resolveAssetUrl(assetPath: string) {
  const normalizedAssetPath = assetPath.replace(/^\/+/, '')
  const embeddedAssetUrl =
    typeof window !== 'undefined' ? window.__OFFLINE_ASSET_MAP__?.[normalizedAssetPath] : undefined

  return embeddedAssetUrl ?? `${assetBaseUrl}${normalizedAssetPath}`
}

function buildSpriteMeta(key: string, asset: WorldSpriteAsset): SpriteSheetMeta {
  const frameCount = asset.frameCount ?? asset.columns * asset.rows
  return {
    key,
    sourceType: asset.sourceType ?? 'spritesheet',
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    columns: asset.columns,
    rows: asset.rows,
    scale: asset.scale,
    frameKeys:
      asset.sourceType === 'frames'
        ? Array.from({ length: frameCount }, (_, frameIndex) => buildFrameTextureKey(key, frameIndex))
        : undefined,
    animations: {
      'walk-left': asset.animations?.walkLeft ?? { start: 0, end: 5, frameRate: 8 },
      'walk-right': asset.animations?.walkRight,
      'walk-down': asset.animations?.walkDown ?? { start: 6, end: 11, frameRate: 8 },
      'walk-down-left': asset.animations?.walkDownLeft,
      'walk-down-right': asset.animations?.walkDownRight,
      'walk-up': asset.animations?.walkUp ?? { start: 12, end: 17, frameRate: 8 },
      'walk-up-left': asset.animations?.walkUpLeft,
      'walk-up-right': asset.animations?.walkUpRight,
      'idle-front': { frame: asset.animations?.idleFront ?? 18 },
      'idle-down': asset.animations?.idleDown != null ? { frame: asset.animations.idleDown } : undefined,
      'idle-down-left': asset.animations?.idleDownLeft != null ? { frame: asset.animations.idleDownLeft } : undefined,
      'idle-down-right': asset.animations?.idleDownRight != null ? { frame: asset.animations.idleDownRight } : undefined,
      'idle-right': asset.animations?.idleRight != null ? { frame: asset.animations.idleRight } : undefined,
      'idle-back': { frame: asset.animations?.idleBack ?? 19 },
      'idle-up': asset.animations?.idleUp != null ? { frame: asset.animations.idleUp } : undefined,
      'idle-up-left': asset.animations?.idleUpLeft != null ? { frame: asset.animations.idleUpLeft } : undefined,
      'idle-up-right': asset.animations?.idleUpRight != null ? { frame: asset.animations.idleUpRight } : undefined,
      'idle-left': { frame: asset.animations?.idleLeft ?? 20 },
    },
  }
}

function buildFrameFileName(frameIndex: number) {
  return `frame_${String(frameIndex).padStart(3, '0')}.png`
}

function buildFrameTextureKey(baseKey: string, frameIndex: number) {
  return `${baseKey}__frame_${frameIndex}`
}

function hashCacheKey(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function getStageRect(x: number, y: number, width: number, height: number) {
  const center = getStagePointFromPercent(x, y)
  return {
    x: center.x,
    y: center.y,
    width: (width / 100) * STAGE_WIDTH,
    height: (height / 100) * STAGE_HEIGHT,
  }
}

function getDisplayMetrics(asset?: WorldSpriteAsset) {
  if (!asset) {
    return { width: 84, height: 84 }
  }

  return {
    width: asset.frameWidth * asset.scale,
    height: asset.frameHeight * asset.scale,
  }
}
