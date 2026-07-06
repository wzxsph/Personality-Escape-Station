import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import sharp from 'sharp'
import { archetypePriority, type ArchetypeId } from '../../../client/src/personality/data/types.ts'
import { resultsById } from '../../../client/src/personality/data/results.ts'
import { worldConfigs, type WorldConfig, type WorldHotspot, type WorldLayerShape } from '../../../client/src/personality/data/worlds.ts'
import { repairWalkableGrid } from '../../../client/src/personality/worldx-native/walkableGridRepair.ts'
import type {
  GeneratedHotspotAsset,
  GeneratedSpriteAsset,
  PersonalityAssetManifest,
} from '../../../client/src/personality/data/assetManifest.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
dotenv.config({ path: path.join(repoRoot, '.env') })
const stage = { width: 900, height: 1600, tileSize: 20 }
const gridSpec = {
  width: Math.round(stage.width / stage.tileSize),
  height: Math.round(stage.height / stage.tileSize),
}
const deterministicWalkableMode = 'fixed-personality-deterministic-v1'
const fixedHotspotSource = 'fixed-personality-coordinate-v1'
const fixedAssetRoot = path.join(repoRoot, 'client/public/personality-assets/fixed')
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

interface CliOptions {
  all: boolean
  archetype?: ArchetypeId
  dryRun: boolean
  publish: boolean
  only?: string
  force: boolean
  skipPlayer: boolean
  proceduralPlayer: boolean
  sourceCharacterDir?: string
}

interface RoomDesign {
  archetypeId: ArchetypeId
  mapAspectRatio: '9:16'
  mapDescription: string
  mapPlan: Record<string, string>
  regions: Array<Record<string, unknown>>
  interactiveElements: Array<Record<string, unknown>>
  worldActions: Array<Record<string, string>>
  assetPlan: Record<string, unknown>
}

interface GenerationStatus {
  archetypeId: ArchetypeId
  runId: string
  outputDir: string
  startedAt: string
  updatedAt: string
  assets: Record<string, {
    status: 'completed' | 'failed' | 'pending'
    path?: string
    error?: string
    updatedAt: string
  }>
}

interface PlayerFrameBox {
  frameIndex: number
  subjectWidth: number
  subjectHeight: number
  centerX: number
  bottom: number
}

interface DetectedPlayerGrid {
  xCenters: number[]
  yCenters: number[]
  method: 'detected-centers-v1' | 'equal-grid-fallback-v1'
}

interface TiledObjectRecord {
  id?: number
  name?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  visible?: boolean
  properties?: Array<{ name: string; type?: string; value: string | number }>
}

interface TiledLayerRecord {
  id?: number
  type?: string
  name?: string
  image?: string
  imagewidth?: number
  imageheight?: number
  opacity?: number
  visible?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  data?: number[]
  objects?: TiledObjectRecord[]
}

interface TiledMapRecord {
  width?: number
  height?: number
  tilewidth?: number
  tileheight?: number
  layers?: TiledLayerRecord[]
  nextobjectid?: number
}

const options = parseArgs(process.argv.slice(2))
const archetypes = options.all ? archetypePriority : [options.archetype ?? 'BEDX']
const outputRoot = options.dryRun
  ? path.join(repoRoot, 'output/personality-assets/dry-run')
  : options.publish
    ? fixedAssetRoot
    : path.join(repoRoot, 'output/personality-assets/runs', runId, 'fixed')

fs.mkdirSync(outputRoot, { recursive: true })

const runFailures: string[] = []
for (const archetypeId of archetypes) {
  const result = await generateFixedAsset(archetypeId)
  runFailures.push(...result.failures.map((failure) => `${archetypeId}:${failure}`))
}

console.log(`\nFixed asset pipeline ${options.dryRun ? 'dry-run' : 'run'} complete.`)
console.log(`Output root: ${outputRoot}`)
if (runFailures.length > 0) {
  console.error(`Incomplete assets: ${runFailures.join(', ')}`)
  process.exitCode = 1
}

async function generateFixedAsset(archetypeId: ArchetypeId) {
  const world = worldConfigs[archetypeId]
  const result = resultsById[archetypeId]
  const lowerId = archetypeId.toLowerCase()
  const targetDir = path.join(outputRoot, lowerId)
  const workDir = path.join(repoRoot, 'output/personality-assets/work', `${runId}-${lowerId}`)
  const roomDesign = buildRoomDesign(world)
  const manifest = buildDraftManifest(world)
  const status = loadGenerationStatus(targetDir, archetypeId)
  const failures: string[] = []

  ensureAssetFolders(targetDir, world)
  writeJson(path.join(targetDir, 'room-design.json'), roomDesign)
  writeText(path.join(targetDir, 'system-prompt.md'), buildRoomSystemPrompt(world))
  writeText(path.join(targetDir, 'prompt-map.md'), buildMapPromptPreview(world, roomDesign))
  writeText(path.join(targetDir, 'player/prompt.md'), buildPlayerAssetPrompt(world))

  for (const hotspot of world.hotspots) {
    const folder = hotspot.kind === 'npc' ? 'agents' : 'props'
    const hotspotDir = path.join(targetDir, folder, hotspot.id)
    fs.mkdirSync(hotspotDir, { recursive: true })
    writeText(path.join(hotspotDir, 'prompt.md'), buildHotspotAssetPrompt(world, hotspot))
    if (hotspot.kind === 'npc') {
      writeText(path.join(hotspotDir, 'system-prompt.md'), buildAgentSystemPrompt(world, hotspot))
    }
  }

  if (!options.dryRun) {
    fs.mkdirSync(workDir, { recursive: true })

    if (shouldRunAsset('map') || hasMapAssets(targetDir)) {
      const mapDir = path.join(targetDir, 'map')
      const mapBackupDir = shouldForceAsset('map') ? backupExistingAssetDir(mapDir) : null
      try {
        const mapResult = await runMapPipeline(world, roomDesign, targetDir, workDir)
        manifest.map = mapResult.map
        manifest.hotspots = manifest.hotspots.map((hotspot) => ({
          ...hotspot,
          interactionBounds: mapResult.boundsByHotspotId[hotspot.id] ?? hotspot.interactionBounds,
        }))
        manifest.spawn = findNearestWalkableSpawn(mapResult.walkableGrid, world.spawn)
        removeAssetDirBackup(mapBackupDir)
        markAssetStatus(status, targetDir, 'map', 'completed', { path: path.join(targetDir, 'map') })
      } catch (error) {
        restoreAssetDirBackup(mapDir, mapBackupDir)
        try {
          await writeNavigationTemplate(world, buildDeterministicWalkableGrid(world), path.join(mapDir, 'navigation-template.png'))
        } catch {
          // Keep the original generation error as the useful failure signal.
        }
        const message = error instanceof Error ? error.message : String(error)
        failures.push('map')
        markAssetStatus(status, targetDir, 'map', 'failed', { error: message, path: path.join(targetDir, 'map') })
        console.error(`[fixed-assets] ${archetypeId} map failed: ${message}`)
      }
    }

    if (shouldRunAsset('player')) {
      try {
        const playerSprite = options.proceduralPlayer
          ? await createProceduralPlayerFrames(world, path.join(targetDir, 'player/frames'), 'forced by --procedural-player')
          : await runCharacterPipeline({
            targetDir: path.join(targetDir, 'player/frames'),
            workDir,
            description: `${result.name} 的主角形象，${result.scene.dressCode}，小小的空间站逃离者，表情克制但有生命力`,
            name: `${archetypeId} Player`,
            role: '人格出逃空间站主角',
            world,
            outputJsonName: `${lowerId}-player.json`,
            mode: 'player-frames',
            promptTemplate: 'generate-player-sheet.md',
            force: shouldForceAsset('player'),
          })
        manifest.player = {
          promptPath: `personality-assets/fixed/${lowerId}/player/prompt.md`,
          sprite: playerSprite,
        }
        markAssetStatus(status, targetDir, 'player', 'completed', { path: path.join(targetDir, 'player/frames') })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[fixed-assets] ${archetypeId} player failed: ${message}`)
        try {
          const fallbackSprite = await createProceduralPlayerFrames(world, path.join(targetDir, 'player/frames'), message)
          manifest.player = {
            promptPath: `personality-assets/fixed/${lowerId}/player/prompt.md`,
            sprite: fallbackSprite,
          }
          markAssetStatus(status, targetDir, 'player', 'completed', {
            path: path.join(targetDir, 'player/frames'),
            error: `procedural fallback used after image model failure: ${message}`,
          })
          console.warn(`[fixed-assets] ${archetypeId} player using procedural fallback frames.`)
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          failures.push('player')
          markAssetStatus(status, targetDir, 'player', 'failed', { error: `${message}; fallback failed: ${fallbackMessage}`, path: path.join(targetDir, 'player/frames') })
          console.error(`[fixed-assets] ${archetypeId} player fallback failed: ${fallbackMessage}`)
        }
      }
    }

    for (const hotspot of world.hotspots) {
      const assetId = `hotspot:${hotspot.id}`
      if (!shouldRunAsset(assetId)) {
        continue
      }
      try {
        if (hotspot.kind === 'npc') {
          const sprite = await runCharacterPipeline({
            targetDir: path.join(targetDir, 'agents', hotspot.id),
            workDir,
            description: `${hotspot.label}，${hotspot.summary}。${hotspot.agentPersona ?? hotspot.lines.join(' ')}。固定摆放坐标：地图舞台 ${hotspot.x}%, ${hotspot.y}%，sprite 底部中心落在该点。`,
            name: hotspot.label,
            role: '人格空间互动 Agent',
            world,
            outputJsonName: `${lowerId}-${hotspot.id}.json`,
            mode: 'image',
            promptTemplate: 'generate-agent-image.md',
            imageKind: 'agent',
            force: shouldForceAsset(assetId),
          })
          updateHotspotSprite(manifest, hotspot.id, sprite)
          markAssetStatus(status, targetDir, assetId, 'completed', { path: path.join(targetDir, 'agents', hotspot.id) })
        } else {
          const sprite = await runCharacterPipeline({
            targetDir: path.join(targetDir, 'props', hotspot.id),
            workDir,
            description: `${hotspot.label}，${hotspot.summary}。互动动作：${hotspot.actionLabel}。固定摆放坐标：地图舞台 ${hotspot.x}%, ${hotspot.y}%，sprite 底部中心落在该点。`,
            name: hotspot.label,
            role: '人格空间互动道具',
            world,
            outputJsonName: `${lowerId}-${hotspot.id}.json`,
            mode: 'image',
            promptTemplate: 'generate-prop-image.md',
            imageKind: 'prop',
            force: shouldForceAsset(assetId),
          })
          updateHotspotSprite(manifest, hotspot.id, sprite)
          markAssetStatus(status, targetDir, assetId, 'completed', { path: path.join(targetDir, 'props', hotspot.id) })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(assetId)
        markAssetStatus(status, targetDir, assetId, 'failed', { error: message })
        console.error(`[fixed-assets] ${archetypeId} hotspot ${hotspot.id} failed: ${message}`)
      }
    }
  }

  const reconciledManifest = reconcileManifestAssets(manifest, targetDir)
  const manifestFileName = hasMapAssets(targetDir) ? 'manifest.json' : 'manifest.partial.json'
  writeJson(path.join(targetDir, manifestFileName), reconciledManifest)
  writeGenerationStatus(targetDir, status)
  console.log(`${failures.length === 0 ? '✓' : '⚠'} ${archetypeId}: ${targetDir}`)
  return { failures }
}

function buildRoomDesign(world: WorldConfig): RoomDesign {
  const result = resultsById[world.id]
  return {
    archetypeId: world.id,
    mapAspectRatio: '9:16',
    mapDescription: [
      `为「人格出逃空间站 / Personality Escape Station」生成 ${world.title} 的竖屏人格空间地图。`,
      `人格主题：${result.name} / ${result.englishName}。`,
      `空间氛围：${world.atmosphere}`,
      `关键词：${world.promptCue}`,
      '画面必须是 9:16 竖屏、俯视游戏地图、无文字、无角色、主路径宽而连续，互动点位于安全区。',
      '地图生成会附带固定导航模板：浅色区域就是最终可行走地面，深色区域就是墙体/家具/不可走背景。请让最终地图的地面形状服从模板，不要让家具盖住模板地面。',
      '互动 Agent 和重点道具会作为独立 sprite 叠加；地图只需要自然的地面留白、家具旁空位或地毯边缘，不要画出 Agent/道具本体。',
      '绝对不要画 dashed boxes、dashed circles、selection outlines、target reticles、UI markers、coordinate dots、placeholder frames、bounding boxes、虚线框、虚线圆、十字准星、坐标点、图例或编辑器选区。',
    ].join('\n'),
    mapPlan: {
      buildingMode: 'personality_room',
      compositionNotes: `900x1600 竖屏构图；出生点约在 ${world.spawn.x}%, ${world.spawn.y}%；核心互动点不要贴边。`,
      worldFunctionSummary: world.mission,
      regionDesignNotes: '以固定导航模板为准，保留一张宽阔、连续、简单的主地面网络：出生点、中心区域和每个互动点之间必须像整块地毯或宽走廊一样连通，不要被碎石/花丛/阴影切碎。',
    },
    regions: [
      {
        id: `${world.id.toLowerCase()}-main-room`,
        name: world.title,
        description: world.atmosphere,
        type: 'area',
        enterable: true,
        placementHint: '占据竖屏中央安全区',
        visualDescription: `${world.landmark.label} 作为视觉中心，但必须待在模板深色区域或浅色地面边缘，不能遮盖主可走地面。`,
      },
      ...world.decorations.map((decoration) => ({
        id: decoration.id,
        name: decoration.label,
        description: `${decoration.depth} decoration`,
        type: 'area',
        enterable: false,
        placementHint: `中心约 ${decoration.x}%, ${decoration.y}%，尺寸约 ${decoration.width}% x ${decoration.height}%`,
        visualDescription: decoration.label,
      })),
    ],
    interactiveElements: world.hotspots.map((hotspot) => ({
      id: hotspot.id,
      name: hotspot.label,
      description: hotspot.summary,
      visualDescription: hotspot.kind === 'npc'
        ? `为互动 Agent「${hotspot.label}」附近预留自然地面留白、座位旁空地或灯光下的可停靠区域；不要画出 Agent 身体本体，也不要画任何框/圆/光标标记。Agent 气质：${hotspot.agentPersona ?? hotspot.lines.join(' ')}`
        : `为互动道具「${hotspot.label}」附近预留自然地面留白、家具旁空地或地毯边缘；不要画出可独立叠加的道具本体，也不要画任何框/圆/光标标记。道具语义：${hotspot.summary}`,
      placementHint: `中心约 ${hotspot.x}%, ${hotspot.y}%，必须贴近宽主路且可从出生点到达；只能用自然空地表达位置，不允许可见定位标记。`,
      interactions: [
        {
          id: `${hotspot.id}-interaction`,
          name: hotspot.actionLabel,
          description: hotspot.reaction,
        },
      ],
    })),
    worldActions: [
      {
        id: `${world.id.toLowerCase()}-collect-fragments`,
        name: '收集人格碎片',
        description: world.mission,
      },
    ],
    assetPlan: {
      player: {
        role: '人格出逃空间站主角',
        dressCode: result.scene.dressCode,
      },
      agents: world.hotspots.filter((hotspot) => hotspot.kind === 'npc').map((hotspot) => hotspot.id),
      props: world.hotspots.filter((hotspot) => hotspot.kind === 'object').map((hotspot) => hotspot.id),
    },
  }
}

function buildDraftManifest(world: WorldConfig): PersonalityAssetManifest {
  const lowerId = world.id.toLowerCase()
  const hotspots = world.hotspots.map<GeneratedHotspotAsset>((hotspot) => {
    const sprite = hotspot.kind === 'npc'
      ? imageSprite(`personality-assets/fixed/${lowerId}/agents/${hotspot.id}/image.png`, {}, 'agent')
      : imageSprite(`personality-assets/fixed/${lowerId}/props/${hotspot.id}/image.png`, {}, 'prop')

    return {
      id: hotspot.id,
      kind: hotspot.kind,
      label: hotspot.label,
      sprite,
      systemPromptPath: hotspot.kind === 'npc'
        ? `personality-assets/fixed/${lowerId}/agents/${hotspot.id}/system-prompt.md`
        : undefined,
      interactionBounds: fixedHotspotBounds(hotspot),
    }
  })

  return {
    version: 1,
    archetypeId: world.id,
    stage,
    spawn: percentPoint(world.spawn.x, world.spawn.y),
    map: {
      backgroundImage: `personality-assets/fixed/${lowerId}/map/background.png`,
      tmjPath: `personality-assets/fixed/${lowerId}/map/map.tmj`,
      walkableGridPath: `personality-assets/fixed/${lowerId}/map/walkable-grid.json`,
      navigationTemplatePath: `personality-assets/fixed/${lowerId}/map/navigation-template.png`,
      roomLayoutPath: `personality-assets/fixed/${lowerId}/map/room-layout.json`,
      stylePackPath: `personality-assets/fixed/${lowerId}/map/style-pack.json`,
      generationMode: 'composite-v1',
    },
    player: {
      promptPath: `personality-assets/fixed/${lowerId}/player/prompt.md`,
      sprite: frameSprite(`personality-assets/fixed/${lowerId}/player/frames`),
    },
    hotspots,
    agents: Object.fromEntries(hotspots.filter((hotspot) => hotspot.kind === 'npc').map((hotspot) => [hotspot.id, hotspot])),
    props: Object.fromEntries(hotspots.filter((hotspot) => hotspot.kind === 'object').map((hotspot) => [hotspot.id, hotspot])),
    safeArea: { x: 72, y: 96, width: 756, height: 1376 },
    provenance: {
      pipeline: 'personality-fixed-assets',
      runId,
      dryRun: options.dryRun,
      generatedAt: new Date().toISOString(),
    },
  }
}

async function runMapPipeline(world: WorldConfig, roomDesign: RoomDesign, targetDir: string, workDir: string) {
  const mapOutputDir = path.join(workDir, 'map-runs')
  const roomDesignPath = path.join(targetDir, 'room-design.json')
  const mapDir = path.join(targetDir, 'map')
  const backgroundPath = path.join(mapDir, 'background.png')
  const tmjPath = path.join(mapDir, 'map.tmj')
  const walkableGridPath = path.join(mapDir, 'walkable-grid.json')
  const navigationTemplatePath = path.join(mapDir, 'navigation-template.png')
  const roomLayoutPath = path.join(mapDir, 'room-layout.json')
  const stylePackPath = path.join(mapDir, 'style-pack.json')
  const deterministicGrid = buildDeterministicWalkableGrid(world)
  const generationMode = process.env.MAP_GENERATION_MODE === 'whole-image' ? 'whole-image-v1' : 'composite-v1'
  fs.mkdirSync(mapOutputDir, { recursive: true })
  fs.mkdirSync(mapDir, { recursive: true })
  await writeNavigationTemplate(world, deterministicGrid, navigationTemplatePath)
  writeJson(roomLayoutPath, buildRoomLayout(world, deterministicGrid))
  writeJson(stylePackPath, buildStylePack(world))

  if (fs.existsSync(backgroundPath) && fs.existsSync(tmjPath) && fs.existsSync(walkableGridPath)) {
    console.log(`[fixed-assets] Reusing existing map assets for ${world.id}. Delete ${mapDir} to regenerate the map.`)
  } else if (generationMode === 'composite-v1') {
    await composeDeterministicBackground(world, deterministicGrid, backgroundPath)
    const tmj = createBlankTmj()
    normalizeTmjStage(tmj)
    setFixedTmjHotspots(tmj, world)
    applyCollisionGridToTmj(tmj, deterministicGrid)
    writeJson(tmjPath, tmj)
    writeJson(walkableGridPath, buildWalkableGrid(world, deterministicGrid, generationMode))
  } else {
    runCommand(process.execPath, [path.join(repoRoot, 'generators/map/src/index.mjs'), roomDesign.mapDescription], {
      WORLD_DESIGN_PATH: roomDesignPath,
      MAP_OUTPUT_DIR: mapOutputDir,
      MAP_ASPECT_RATIO: '9:16',
      MAP_STAGE_WIDTH: String(stage.width),
      MAP_STAGE_HEIGHT: String(stage.height),
      MAP_STAGE_TILE_SIZE: String(stage.tileSize),
      MAP_STAGE_GRID_WIDTH: String(gridSpec.width),
      MAP_STAGE_GRID_HEIGHT: String(gridSpec.height),
      MAP_SKIP_VLM_OVERLAYS: '1',
      MAP_LAYOUT_TEMPLATE_PATH: navigationTemplatePath,
      MAP_TEMPLATE_ADHERENCE_CHECK: '1',
      MAP_TEMPLATE_ADHERENCE_STRICT: '1',
      MAP_ENFORCE_TEMPLATE_FLOOR_MASK: '1',
      MAP_REQUIRE_STEP1_REVIEW: '1',
      ORIGINAL_USER_PROMPT: world.promptCue,
    })

    const latestRunDir = getLatestMapRunDir(mapOutputDir)
    copyRequired(path.join(latestRunDir, '06-background.png'), backgroundPath)
    copyRequired(path.join(latestRunDir, '06-final.tmj'), tmjPath)
    copyRequired(path.join(latestRunDir, '05-walkable-grid.json'), walkableGridPath)
  }

  const tmj = JSON.parse(fs.readFileSync(tmjPath, 'utf-8')) as TiledMapRecord
  const walkableGrid = buildWalkableGrid(world, deterministicGrid, generationMode)
  normalizeTmjStage(tmj)
  setFixedTmjHotspots(tmj, world)
  applyCollisionGridToTmj(tmj, deterministicGrid)
  writeJson(tmjPath, tmj)
  writeJson(walkableGridPath, walkableGrid)
  const boundsByHotspotId = readInteractiveBounds(tmj)

  return {
    map: {
      backgroundImage: `personality-assets/fixed/${world.id.toLowerCase()}/map/background.png`,
      tmjPath: `personality-assets/fixed/${world.id.toLowerCase()}/map/map.tmj`,
      walkableGridPath: `personality-assets/fixed/${world.id.toLowerCase()}/map/walkable-grid.json`,
      navigationTemplatePath: `personality-assets/fixed/${world.id.toLowerCase()}/map/navigation-template.png`,
      roomLayoutPath: `personality-assets/fixed/${world.id.toLowerCase()}/map/room-layout.json`,
      stylePackPath: `personality-assets/fixed/${world.id.toLowerCase()}/map/style-pack.json`,
      generationMode,
    },
    boundsByHotspotId,
    walkableGrid,
  }
}

function createBlankTmj(): TiledMapRecord {
  return {
    width: gridSpec.width,
    height: gridSpec.height,
    tilewidth: stage.tileSize,
    tileheight: stage.tileSize,
    layers: [],
    nextobjectid: 1,
  }
}

function buildWalkableGrid(world: WorldConfig, deterministicGrid: number[][], generationMode: 'composite-v1' | 'whole-image-v1') {
  return {
    gridWidth: gridSpec.width,
    gridHeight: gridSpec.height,
    tileSize: stage.tileSize,
    stageWidth: stage.width,
    stageHeight: stage.height,
    grid: deterministicGrid,
    source: {
      mode: deterministicWalkableMode,
      generationMode,
      hotspotSource: fixedHotspotSource,
      runId,
      generatedAt: new Date().toISOString(),
      templatePath: `personality-assets/fixed/${world.id.toLowerCase()}/map/navigation-template.png`,
      templateVersion: deterministicWalkableMode,
      note: generationMode === 'composite-v1'
        ? 'Fixed personality MVP uses deterministic navigation and programmatic background compositing.'
        : 'Experimental whole-image generation; final runtime collision still uses deterministic navigation.',
    },
  }
}

function buildRoomLayout(world: WorldConfig, deterministicGrid: number[][]) {
  return {
    version: 'room-layout-template-v1',
    archetypeId: world.id,
    stage,
    gridSpec,
    navigationMode: deterministicWalkableMode,
    spawn: percentPoint(world.spawn.x, world.spawn.y),
    landmark: {
      ...world.landmark,
      rect: percentRect(world.landmark.x, world.landmark.y, world.landmark.width, world.landmark.height),
    },
    decorations: world.decorations.map((decoration) => ({
      ...decoration,
      rect: percentRect(decoration.x, decoration.y, decoration.width, decoration.height),
      blocksMovement: isBlockingDecoration(decoration.shape),
    })),
    hotspots: world.hotspots.map((hotspot) => ({
      id: hotspot.id,
      kind: hotspot.kind,
      label: hotspot.label,
      anchor: percentPoint(hotspot.x, hotspot.y),
      bounds: fixedHotspotBounds(hotspot),
    })),
    masks: {
      walkableGrid: deterministicGrid,
    },
  }
}

function buildStylePack(world: WorldConfig) {
  const result = resultsById[world.id]
  const palettes: Partial<Record<ArchetypeId, {
    floor: string
    floorAlt: string
    blocked: string
    wall: string
    trim: string
    accent: string
    glow: string
    shadow: string
  }>> = {
    BEDX: {
      floor: '#6c5063',
      floorAlt: '#9b7180',
      blocked: '#100d19',
      wall: '#24182d',
      trim: '#d09a72',
      accent: '#f0bf8a',
      glow: '#ffd88a',
      shadow: '#06050d',
    },
    GONE: {
      floor: '#b9d5d2',
      floorAlt: '#d6ebe6',
      blocked: '#111923',
      wall: '#243444',
      trim: '#6f929b',
      accent: '#f0b55f',
      glow: '#aee7ff',
      shadow: '#050a11',
    },
    SIDE: {
      floor: '#c9c4df',
      floorAlt: '#ded9f0',
      blocked: '#171427',
      wall: '#302955',
      trim: '#7d70a7',
      accent: '#f2a2c4',
      glow: '#e8c8ff',
      shadow: '#080712',
    },
    SPRK: {
      floor: '#eed393',
      floorAlt: '#ffe3a5',
      blocked: '#18101b',
      wall: '#41203c',
      trim: '#a95d63',
      accent: '#ffcf4d',
      glow: '#ffe680',
      shadow: '#08050d',
    },
    F1SH: {
      floor: '#aacbc4',
      floorAlt: '#d0e4df',
      blocked: '#0c1820',
      wall: '#173447',
      trim: '#4f8a93',
      accent: '#f1bd83',
      glow: '#8be7ff',
      shadow: '#03090e',
    },
    NOCT: {
      floor: '#bfc0d9',
      floorAlt: '#d8d9ec',
      blocked: '#111323',
      wall: '#232845',
      trim: '#646b9a',
      accent: '#e2a56b',
      glow: '#d6c5ff',
      shadow: '#050611',
    },
    UNDO: {
      floor: '#d9d0bf',
      floorAlt: '#eee5d4',
      blocked: '#17171a',
      wall: '#383638',
      trim: '#8f8580',
      accent: '#8fc7ff',
      glow: '#cfe9ff',
      shadow: '#070708',
    },
    MUT8: {
      floor: '#b5d3c0',
      floorAlt: '#d2ead8',
      blocked: '#10181b',
      wall: '#243f3a',
      trim: '#6aa47f',
      accent: '#ff8fd0',
      glow: '#b8ffcf',
      shadow: '#050b0c',
    },
    BUFR: {
      floor: '#d7c8a8',
      floorAlt: '#eadcbd',
      blocked: '#14151d',
      wall: '#303044',
      trim: '#857a9c',
      accent: '#f5c66d',
      glow: '#fff0a8',
      shadow: '#070812',
    },
    JANK: {
      floor: '#c8d4c2',
      floorAlt: '#e0e8d8',
      blocked: '#151713',
      wall: '#34382e',
      trim: '#7f926f',
      accent: '#f0ad67',
      glow: '#e7ffa1',
      shadow: '#070906',
    },
    FINE: {
      floor: '#d7c7d0',
      floorAlt: '#eadce4',
      blocked: '#17121a',
      wall: '#3b2d3b',
      trim: '#9a728b',
      accent: '#f2b6cf',
      glow: '#ffd5e6',
      shadow: '#08050a',
    },
    GL1T: {
      floor: '#bde2d9',
      floorAlt: '#e1fff7',
      blocked: '#0f1020',
      wall: '#2a2451',
      trim: '#5be0c7',
      accent: '#ff6bd8',
      glow: '#7dffe7',
      shadow: '#050512',
    },
  }
  return {
    version: 'style-pack-composite-v1',
    archetypeId: world.id,
    title: world.title,
    mood: world.atmosphere,
    personality: result.name,
    palette: palettes[world.id] ?? palettes.BEDX,
    compositor: {
      floorPattern: 'quiet-carpet-noise',
      edgeTrim: 'stitched-stone-border',
      lighting: 'warm-vignette-and-hotspot-glow',
      aiRole: 'AI generates small replaceable style textures/landmarks in future revisions; layout and collision stay deterministic.',
    },
  }
}

type CompositePalette = NonNullable<ReturnType<typeof buildStylePack>['palette']>

async function composeDeterministicBackground(world: WorldConfig, grid: number[][], destination: string) {
  const stylePack = buildStylePack(world)
  const svg = buildCompositeMapSvg(world, grid, stylePack.palette)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  await sharp(Buffer.from(svg))
    .resize(stage.width, stage.height, { fit: 'fill' })
    .png()
    .toFile(destination)
}

function buildCompositeMapSvg(
  world: WorldConfig,
  grid: number[][],
  palette: CompositePalette,
) {
  const floorMaskRuns = buildFloorRunRects(grid, '#ffffff')
  const edgeLines = buildFloorEdgeLines(grid, palette.trim)
  const rearDecorations = world.decorations.filter((decoration) => decoration.depth === 'rear').map((decoration) => renderDecoration(decoration, palette)).join('')
  const midDecorations = world.decorations.filter((decoration) => decoration.depth === 'mid').map((decoration) => renderDecoration(decoration, palette)).join('')
  const frontDecorations = world.decorations.filter((decoration) => decoration.depth === 'front').map((decoration) => renderDecoration(decoration, palette)).join('')
  const landmarkSvg = renderLandmark(world, palette)
  const glowSvg = [
    renderGlow(percentPoint(world.spawn.x, world.spawn.y), palette.glow, 0.16, 240),
    ...world.hotspots.map((hotspot) => renderGlow(percentPoint(hotspot.x, hotspot.y), palette.glow, hotspot.kind === 'npc' ? 0.2 : 0.14, hotspot.kind === 'npc' ? 220 : 160)),
    ...world.decorations.filter((item) => item.depth !== 'front').map((item) => renderGlow(percentPoint(item.x, item.y), palette.glow, 0.1, 150)),
  ].join('')
  const wallMotifs = renderWallMotifs(world, palette)
  const illustratedFloor = renderIllustratedFloor(world, palette)
  const floorDetails = renderFloorDetails(world, palette)
  const hotspotGrounding = renderHotspotGrounding(world, palette)

  return [
    `<svg width="${stage.width}" height="${stage.height}" viewBox="0 0 ${stage.width} ${stage.height}" xmlns="http://www.w3.org/2000/svg">`,
    '<defs>',
    `<linearGradient id="roomBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.blocked}"/><stop offset="0.58" stop-color="${palette.wall}"/><stop offset="1" stop-color="${palette.shadow}"/></linearGradient>`,
    `<linearGradient id="backWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.wall}" stop-opacity="0.96"/><stop offset="1" stop-color="${palette.blocked}" stop-opacity="0.92"/></linearGradient>`,
    `<linearGradient id="floorLight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.floorAlt}" stop-opacity="0.36"/><stop offset="0.45" stop-color="${palette.floor}" stop-opacity="0.2"/><stop offset="1" stop-color="${palette.shadow}" stop-opacity="0.2"/></linearGradient>`,
    `<radialGradient id="floorBloom" cx="50%" cy="68%" r="58%"><stop offset="0" stop-color="${palette.glow}" stop-opacity="0.22"/><stop offset="0.5" stop-color="${palette.accent}" stop-opacity="0.08"/><stop offset="1" stop-color="${palette.floor}" stop-opacity="0"/></radialGradient>`,
    `<pattern id="floorPattern" width="72" height="72" patternUnits="userSpaceOnUse"><rect width="72" height="72" fill="${palette.floor}"/><path d="M7 41 C19 33 36 48 58 35" stroke="${palette.floorAlt}" stroke-opacity="0.1" stroke-width="3" fill="none"/><path d="M3 17 C20 22 34 10 66 18" stroke="${palette.shadow}" stroke-opacity="0.06" stroke-width="3" fill="none"/><path d="M14 61 C28 55 44 67 62 58" stroke="${palette.floorAlt}" stroke-opacity="0.08" stroke-width="2.5" fill="none"/><circle cx="17" cy="20" r="1.6" fill="${palette.glow}" opacity="0.14"/><circle cx="51" cy="49" r="1.2" fill="${palette.trim}" opacity="0.1"/><circle cx="33" cy="34" r="0.9" fill="${palette.floorAlt}" opacity="0.12"/></pattern>`,
    `<pattern id="wallPattern" width="84" height="84" patternUnits="userSpaceOnUse"><rect width="84" height="84" fill="${palette.wall}"/><circle cx="20" cy="22" r="1.8" fill="${palette.trim}" opacity="0.1"/><circle cx="62" cy="52" r="1.4" fill="${palette.accent}" opacity="0.07"/><path d="M9 70 C25 62 43 76 74 64" stroke="${palette.trim}" stroke-opacity="0.055" stroke-width="4" fill="none"/></pattern>`,
    `<filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="22" stdDeviation="16" flood-color="#000000" flood-opacity="0.45"/></filter>`,
    `<filter id="smallShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#000000" flood-opacity="0.5"/></filter>`,
    `<filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<radialGradient id="vignette" cx="50%" cy="46%" r="76%"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="0.68" stop-color="#000000" stop-opacity="0.16"/><stop offset="1" stop-color="#000000" stop-opacity="0.62"/></radialGradient>`,
    `<mask id="walkableMask" maskUnits="userSpaceOnUse">${floorMaskRuns}</mask>`,
    '</defs>',
    `<rect width="100%" height="100%" fill="url(#roomBg)"/>`,
    `<rect x="${stage.width * 0.07}" y="${stage.height * 0.08}" width="${stage.width * 0.86}" height="${stage.height * 0.86}" rx="56" fill="url(#wallPattern)" opacity="0.96"/>`,
    `<path d="M74 180 Q450 92 826 180 L826 640 Q450 710 74 640 Z" fill="url(#backWall)" opacity="0.72"/>`,
    `<path d="M92 652 Q450 720 808 652" stroke="${palette.trim}" stroke-opacity="0.26" stroke-width="10" fill="none" stroke-linecap="round"/>`,
    wallMotifs,
    glowSvg,
    `<g opacity="0.12"><rect width="${stage.width}" height="${stage.height}" fill="${palette.floor}" mask="url(#walkableMask)"/></g>`,
    illustratedFloor,
    `<ellipse cx="${stage.width / 2}" cy="${stage.height * 0.72}" rx="360" ry="480" fill="url(#floorBloom)"/>`,
    renderFloorAtmosphere(world, palette),
    floorDetails,
    `<g opacity="0.12">${edgeLines}</g>`,
    rearDecorations,
    landmarkSvg,
    midDecorations,
    hotspotGrounding,
    frontDecorations,
    `<rect width="100%" height="100%" fill="url(#vignette)"/>`,
    '</svg>',
  ].join('')
}

function renderWallMotifs(world: WorldConfig, palette: CompositePalette) {
  const sparkles = [
    [132, 226, 2.2],
    [214, 300, 1.4],
    [302, 218, 1.6],
    [574, 214, 1.5],
    [706, 286, 2],
    [774, 420, 1.2],
    [128, 512, 1.1],
    [820, 540, 1.5],
  ].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.glow}" opacity="0.32"/>`).join('')
  const sideCurtains = [
    `<path d="M84 180 C128 250 132 520 94 650 L72 644 L72 182 Z" fill="${palette.shadow}" opacity="0.34"/>`,
    `<path d="M816 180 C772 250 768 520 806 650 L828 644 L828 182 Z" fill="${palette.shadow}" opacity="0.34"/>`,
    `<path d="M102 204 C128 330 122 480 104 626" stroke="${palette.trim}" stroke-opacity="0.18" stroke-width="8" fill="none" stroke-linecap="round"/>`,
    `<path d="M798 204 C772 330 778 480 796 626" stroke="${palette.trim}" stroke-opacity="0.18" stroke-width="8" fill="none" stroke-linecap="round"/>`,
  ].join('')
  const ceilingTrim = `<path d="M130 178 Q450 116 770 178" stroke="${palette.trim}" stroke-opacity="0.22" stroke-width="8" fill="none" stroke-linecap="round"/>`
  const lowLights = world.hotspots.map((hotspot) => {
    const point = percentPoint(hotspot.x, hotspot.y)
    return `<path d="M${point.x - 46} ${point.y - 118} Q${point.x} ${point.y - 145} ${point.x + 46} ${point.y - 118}" stroke="${palette.glow}" stroke-opacity="0.08" stroke-width="10" fill="none" stroke-linecap="round"/>`
  }).join('')
  return `<g>${sideCurtains}${ceilingTrim}${sparkles}${lowLights}</g>`
}

function renderIllustratedFloor(world: WorldConfig, palette: CompositePalette) {
  const spawn = percentPoint(world.spawn.x, world.spawn.y)
  const bed = percentRect(world.landmark.x, world.landmark.y, world.landmark.width, world.landmark.height)
  const topY = Math.max(620, bed.y + bed.height * 0.42)
  const left = 128
  const right = 790
  const lower = Math.min(1448, spawn.y + 224)
  const floorPath = [
    `M${left + 52} ${topY + 40}`,
    `C${left + 92} ${topY - 12}, ${left + 210} ${topY - 20}, ${bed.x + 72} ${topY + 28}`,
    `C${bed.x + bed.width * 0.36} ${topY - 38}, ${bed.x + bed.width * 0.76} ${topY - 34}, ${bed.x + bed.width - 34} ${topY + 36}`,
    `C${right - 130} ${topY - 10}, ${right - 34} ${topY + 12}, ${right} ${topY + 82}`,
    `L${right - 8} ${lower - 74}`,
    `C${right - 96} ${lower + 44}, ${left + 84} ${lower + 48}, ${left - 18} ${lower - 62}`,
    `L${left - 16} ${topY + 160}`,
    `C${left - 28} ${topY + 106}, ${left + 8} ${topY + 64}, ${left + 52} ${topY + 40}`,
    'Z',
  ].join(' ')
  const innerPath = [
    `M${left + 72} ${topY + 108}`,
    `C${left + 196} ${topY + 36}, ${right - 154} ${topY + 42}, ${right - 58} ${topY + 122}`,
    `L${right - 64} ${lower - 120}`,
    `C${right - 160} ${lower - 22}, ${left + 170} ${lower - 18}, ${left + 40} ${lower - 116}`,
    `L${left + 36} ${topY + 194}`,
    `C${left + 32} ${topY + 156}, ${left + 44} ${topY + 128}, ${left + 72} ${topY + 108}`,
    'Z',
  ].join(' ')
  return [
    `<g filter="url(#softShadow)">`,
    `<path d="${floorPath}" fill="#000000" opacity="0.28" transform="translate(0 22)"/>`,
    `<path d="${floorPath}" fill="url(#floorPattern)" opacity="0.98"/>`,
    `<path d="${innerPath}" fill="url(#floorLight)" opacity="0.78"/>`,
    `<path d="${floorPath}" fill="none" stroke="${palette.shadow}" stroke-opacity="0.38" stroke-width="16" stroke-linejoin="round"/>`,
    `<path d="${floorPath}" fill="none" stroke="${palette.trim}" stroke-opacity="0.3" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M${left + 74} ${topY + 86} C${left + 180} ${topY + 36}, ${right - 198} ${topY + 44}, ${right - 90} ${topY + 96}" stroke="${palette.glow}" stroke-opacity="0.1" stroke-width="12" fill="none" stroke-linecap="round"/>`,
    `</g>`,
  ].join('')
}

function renderFloorAtmosphere(world: WorldConfig, palette: CompositePalette) {
  const pieces: string[] = []
  const spawn = percentPoint(world.spawn.x, world.spawn.y)
  pieces.push(`<ellipse cx="${spawn.x}" cy="${Math.min(stage.height - 140, spawn.y + 138)}" rx="232" ry="92" fill="${palette.accent}" opacity="0.13"/>`)
  for (const hotspot of world.hotspots) {
    const point = percentPoint(hotspot.x, hotspot.y)
    pieces.push(`<circle cx="${point.x}" cy="${point.y}" r="${hotspot.kind === 'npc' ? 72 : 52}" fill="${palette.glow}" opacity="${hotspot.kind === 'npc' ? 0.08 : 0.052}"/>`)
  }
  pieces.push(`<path d="M${stage.width * 0.19} ${stage.height * 0.82} C${stage.width * 0.36} ${stage.height * 0.78}, ${stage.width * 0.62} ${stage.height * 0.83}, ${stage.width * 0.81} ${stage.height * 0.78}" stroke="${palette.floorAlt}" stroke-opacity="0.13" stroke-width="32" stroke-linecap="round" fill="none"/>`)
  return pieces.join('')
}

function renderFloorDetails(world: WorldConfig, palette: CompositePalette) {
  const spawn = percentPoint(world.spawn.x, world.spawn.y)
  const seams = [
    `<path d="M178 942 C260 892 334 918 410 884 C498 844 596 886 720 840" stroke="${palette.floorAlt}" stroke-opacity="0.12" stroke-width="10" fill="none" stroke-linecap="round"/>`,
    `<path d="M182 1116 C306 1070 424 1132 550 1082 C620 1054 672 1062 724 1098" stroke="${palette.trim}" stroke-opacity="0.12" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    `<path d="M246 1348 C346 1308 454 1352 562 1316 C626 1294 688 1316 746 1348" stroke="${palette.floorAlt}" stroke-opacity="0.12" stroke-width="9" fill="none" stroke-linecap="round"/>`,
    `<ellipse cx="${spawn.x}" cy="${spawn.y + 36}" rx="80" ry="28" fill="${palette.shadow}" opacity="0.18"/>`,
  ]
  const crumbs = [
    [206, 824],
    [304, 972],
    [676, 956],
    [228, 1236],
    [618, 1258],
    [736, 1176],
    [356, 1378],
    [514, 1436],
  ].map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="3" fill="${palette.glow}" opacity="0.12"/>`)
  return `<g>${seams.join('')}${crumbs.join('')}</g>`
}

function renderHotspotGrounding(world: WorldConfig, palette: CompositePalette) {
  return world.hotspots.map((hotspot) => {
    const point = percentPoint(hotspot.x, hotspot.y)
    const radiusX = hotspot.kind === 'npc' ? 54 : 42
    const radiusY = hotspot.kind === 'npc' ? 18 : 14
    return [
      `<ellipse cx="${point.x}" cy="${point.y + 10}" rx="${radiusX}" ry="${radiusY}" fill="${palette.shadow}" opacity="0.26"/>`,
      `<ellipse cx="${point.x}" cy="${point.y + 5}" rx="${Math.round(radiusX * 0.62)}" ry="${Math.round(radiusY * 0.55)}" fill="${palette.glow}" opacity="0.075"/>`,
    ].join('')
  }).join('')
}

function buildFloorRunRects(grid: number[][], fill: string) {
  const rects: string[] = []
  for (let y = 0; y < grid.length; y += 1) {
    let runStart: number | null = null
    for (let x = 0; x <= gridSpec.width; x += 1) {
      const walkable = x < gridSpec.width && grid[y]?.[x] === 0
      if (walkable && runStart === null) {
        runStart = x
      }
      if ((!walkable || x === gridSpec.width) && runStart !== null) {
        rects.push(`<rect x="${runStart * stage.tileSize}" y="${y * stage.tileSize}" width="${(x - runStart) * stage.tileSize}" height="${stage.tileSize}" fill="${fill}"/>`)
        runStart = null
      }
    }
  }
  return rects.join('')
}

function buildFloorEdgeLines(grid: number[][], color: string) {
  const lines: string[] = []
  const addLine = (x1: number, y1: number, x2: number, y2: number) => {
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#080812" stroke-opacity="0.18" stroke-width="7" stroke-linecap="round"/>`)
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-opacity="0.42" stroke-width="3" stroke-linecap="round"/>`)
  }
  for (let y = 0; y < gridSpec.height; y += 1) {
    for (let x = 0; x < gridSpec.width; x += 1) {
      if (grid[y]?.[x] !== 0) {
        continue
      }
      const px = x * stage.tileSize
      const py = y * stage.tileSize
      if (grid[y - 1]?.[x] !== 0) addLine(px, py, px + stage.tileSize, py)
      if (grid[y + 1]?.[x] !== 0) addLine(px, py + stage.tileSize, px + stage.tileSize, py + stage.tileSize)
      if (grid[y]?.[x - 1] !== 0) addLine(px, py, px, py + stage.tileSize)
      if (grid[y]?.[x + 1] !== 0) addLine(px + stage.tileSize, py, px + stage.tileSize, py + stage.tileSize)
    }
  }
  return lines.join('')
}

function renderLandmark(world: WorldConfig, palette: CompositePalette) {
  const rect = percentRect(world.landmark.x, world.landmark.y, world.landmark.width, world.landmark.height)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  if (world.landmark.shape === 'nest') {
    return [
      `<g filter="url(#smallShadow)">`,
      `<ellipse cx="${cx}" cy="${cy + rect.height * 0.18}" rx="${rect.width * 0.53}" ry="${rect.height * 0.34}" fill="${palette.shadow}" opacity="0.38"/>`,
      `<ellipse cx="${cx}" cy="${cy}" rx="${rect.width * 0.52}" ry="${rect.height * 0.44}" fill="${palette.wall}" opacity="0.98"/>`,
      `<ellipse cx="${cx}" cy="${cy + rect.height * 0.02}" rx="${rect.width * 0.44}" ry="${rect.height * 0.34}" fill="${palette.accent}" opacity="0.66"/>`,
      `<path d="M${cx - rect.width * 0.42} ${cy - rect.height * 0.02} C${cx - rect.width * 0.18} ${cy - rect.height * 0.22}, ${cx + rect.width * 0.22} ${cy - rect.height * 0.19}, ${cx + rect.width * 0.42} ${cy + rect.height * 0.01}" stroke="${palette.glow}" stroke-opacity="0.24" stroke-width="18" fill="none" stroke-linecap="round"/>`,
      `<ellipse cx="${cx - rect.width * 0.16}" cy="${cy - rect.height * 0.06}" rx="${rect.width * 0.18}" ry="${rect.height * 0.16}" fill="${palette.floorAlt}" opacity="0.88"/>`,
      `<ellipse cx="${cx + rect.width * 0.15}" cy="${cy + rect.height * 0.02}" rx="${rect.width * 0.17}" ry="${rect.height * 0.15}" fill="${palette.floorAlt}" opacity="0.72"/>`,
      `<ellipse cx="${cx - rect.width * 0.21}" cy="${cy - rect.height * 0.12}" rx="${rect.width * 0.05}" ry="${rect.height * 0.025}" fill="#ffffff" opacity="0.22"/>`,
      `<path d="M${cx - rect.width * 0.28} ${cy + rect.height * 0.18} C${cx - rect.width * 0.1} ${cy + rect.height * 0.28}, ${cx + rect.width * 0.14} ${cy + rect.height * 0.12}, ${cx + rect.width * 0.32} ${cy + rect.height * 0.2}" stroke="${palette.shadow}" stroke-opacity="0.22" stroke-width="10" fill="none" stroke-linecap="round"/>`,
      `</g>`,
    ].join('')
  }
  if (world.landmark.shape === 'pool') {
    return [
      `<ellipse cx="${cx}" cy="${cy}" rx="${rect.width * 0.5}" ry="${rect.height * 0.46}" fill="${palette.shadow}" opacity="0.28"/>`,
      `<ellipse cx="${cx}" cy="${cy - 4}" rx="${rect.width * 0.46}" ry="${rect.height * 0.4}" fill="${palette.accent}" opacity="0.5"/>`,
      `<ellipse cx="${cx}" cy="${cy - 6}" rx="${rect.width * 0.32}" ry="${rect.height * 0.26}" fill="${palette.floorAlt}" opacity="0.34"/>`,
    ].join('')
  }
  return [
    `<g filter="url(#smallShadow)">`,
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="30" fill="${palette.wall}" opacity="0.96"/>`,
    `<rect x="${rect.x + 18}" y="${rect.y + 18}" width="${Math.max(10, rect.width - 36)}" height="${Math.max(10, rect.height - 36)}" rx="20" fill="${palette.accent}" opacity="0.32"/>`,
    `<path d="M${rect.x + 28} ${rect.y + rect.height * 0.68} H${rect.x + rect.width - 28}" stroke="${palette.glow}" stroke-opacity="0.18" stroke-width="8" stroke-linecap="round"/>`,
    `</g>`,
  ].join('')
}

function renderDecoration(decoration: WorldConfig['decorations'][number], palette: CompositePalette) {
  const rect = percentRect(decoration.x, decoration.y, decoration.width, decoration.height)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  if (decoration.shape === 'pool') {
    return [
      `<g filter="url(#smallShadow)">`,
      `<ellipse cx="${cx}" cy="${cy}" rx="${rect.width / 2}" ry="${rect.height / 2}" fill="${palette.shadow}" opacity="0.18"/>`,
      `<ellipse cx="${cx}" cy="${cy - 5}" rx="${rect.width * 0.48}" ry="${rect.height * 0.43}" fill="${palette.accent}" opacity="${decoration.depth === 'front' ? 0.34 : 0.24}"/>`,
      `<path d="M${rect.x + rect.width * 0.16} ${cy - rect.height * 0.02} C${cx - rect.width * 0.12} ${cy - rect.height * 0.2}, ${cx + rect.width * 0.12} ${cy + rect.height * 0.15}, ${rect.x + rect.width * 0.84} ${cy - rect.height * 0.02}" stroke="${palette.glow}" stroke-opacity="0.2" stroke-width="8" fill="none" stroke-linecap="round"/>`,
      `</g>`,
    ].join('')
  }
  if (decoration.shape === 'arch') {
    return [
      `<g filter="url(#smallShadow)">`,
      `<path d="M${rect.x},${rect.y + rect.height} L${rect.x},${rect.y + rect.height * 0.42} Q${cx},${rect.y - rect.height * 0.18} ${rect.x + rect.width},${rect.y + rect.height * 0.42} L${rect.x + rect.width},${rect.y + rect.height} Z" fill="${palette.shadow}" opacity="0.72"/>`,
      `<path d="M${rect.x + rect.width * 0.14},${rect.y + rect.height * 0.86} L${rect.x + rect.width * 0.14},${rect.y + rect.height * 0.45} Q${cx},${rect.y + rect.height * 0.08} ${rect.x + rect.width * 0.86},${rect.y + rect.height * 0.45} L${rect.x + rect.width * 0.86},${rect.y + rect.height * 0.86} Z" fill="${palette.glow}" opacity="0.22"/>`,
      `<circle cx="${cx + rect.width * 0.18}" cy="${rect.y + rect.height * 0.36}" r="${Math.max(8, rect.width * 0.08)}" fill="${palette.glow}" opacity="0.55"/>`,
      `<circle cx="${cx - rect.width * 0.18}" cy="${rect.y + rect.height * 0.42}" r="2.4" fill="${palette.floorAlt}" opacity="0.6"/>`,
      `<circle cx="${cx + rect.width * 0.02}" cy="${rect.y + rect.height * 0.28}" r="1.8" fill="${palette.floorAlt}" opacity="0.55"/>`,
      `<path d="M${rect.x + rect.width * 0.28} ${rect.y + rect.height * 0.86} V${rect.y + rect.height * 0.44}" stroke="${palette.trim}" stroke-opacity="0.24" stroke-width="4"/>`,
      `<path d="M${rect.x + rect.width * 0.72} ${rect.y + rect.height * 0.86} V${rect.y + rect.height * 0.44}" stroke="${palette.trim}" stroke-opacity="0.24" stroke-width="4"/>`,
      `</g>`,
    ].join('')
  }
  const opacity = decoration.depth === 'rear' ? 0.6 : decoration.depth === 'front' ? 0.48 : 0.72
  if (decoration.shape === 'panel' || decoration.shape === 'console' || decoration.shape === 'booth') {
    return [
      `<g filter="url(#smallShadow)" opacity="${opacity + 0.14}">`,
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="20" fill="${palette.shadow}"/>`,
      `<rect x="${rect.x + 10}" y="${rect.y + 10}" width="${Math.max(8, rect.width - 20)}" height="${Math.max(8, rect.height - 20)}" rx="14" fill="${palette.wall}"/>`,
      `<rect x="${rect.x + 22}" y="${rect.y + 30}" width="${Math.max(8, rect.width - 44)}" height="${Math.max(8, rect.height * 0.22)}" rx="8" fill="${palette.accent}" opacity="0.22"/>`,
      `<rect x="${rect.x + 22}" y="${rect.y + rect.height * 0.56}" width="${Math.max(8, rect.width - 44)}" height="${Math.max(8, rect.height * 0.22)}" rx="8" fill="${palette.accent}" opacity="0.14"/>`,
      `<circle cx="${cx}" cy="${rect.y + rect.height * 0.46}" r="6" fill="${palette.glow}" opacity="0.54"/>`,
      `<path d="M${rect.x + 20} ${rect.y + rect.height - 22} H${rect.x + rect.width - 20}" stroke="${palette.trim}" stroke-opacity="0.18" stroke-width="5" stroke-linecap="round"/>`,
      `</g>`,
    ].join('')
  }
  return [
    `<g filter="url(#smallShadow)" opacity="${opacity}">`,
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="18" fill="${palette.wall}"/>`,
    `<rect x="${rect.x + 10}" y="${rect.y + 10}" width="${Math.max(8, rect.width - 20)}" height="${Math.max(8, rect.height - 20)}" rx="12" fill="${palette.accent}" opacity="0.16"/>`,
    `</g>`,
  ].join('')
}

function renderGlow(point: { x: number; y: number }, color: string, opacity: number, radius: number) {
  return `<circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="${color}" opacity="${opacity}"/>`
}

function normalizeTmjStage(tmj: TiledMapRecord) {
  tmj.width = gridSpec.width
  tmj.height = gridSpec.height
  tmj.tilewidth = stage.tileSize
  tmj.tileheight = stage.tileSize
  tmj.layers ??= []

  let background = tmj.layers.find((item) => item.type === 'imagelayer' && item.name === 'background')
  if (!background) {
    background = {
      id: nextLayerId(tmj),
      name: 'background',
      type: 'imagelayer',
    }
    tmj.layers.unshift(background)
  }
  Object.assign(background, {
    image: 'background.png',
    imagewidth: stage.width,
    imageheight: stage.height,
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
  })

  if (!tmj.layers.some((item) => item.type === 'tilelayer' && item.name === 'collision')) {
    tmj.layers.push({
      id: nextLayerId(tmj),
      name: 'collision',
      type: 'tilelayer',
      width: gridSpec.width,
      height: gridSpec.height,
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      data: [],
    })
  }

  if (!tmj.layers.some((item) => item.type === 'objectgroup' && item.name === 'interactive_objects')) {
    tmj.layers.push({
      id: nextLayerId(tmj),
      name: 'interactive_objects',
      type: 'objectgroup',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      objects: [],
    })
  }
}

function applyCollisionGridToTmj(tmj: TiledMapRecord, grid: number[][]) {
  const layer = tmj.layers?.find((item) => item.type === 'tilelayer' && item.name === 'collision')
  if (!layer) {
    return
  }
  layer.width = gridSpec.width
  layer.height = gridSpec.height
  layer.opacity = 1
  layer.visible = true
  layer.x = 0
  layer.y = 0
  layer.data = grid.flat().map((cell) => cell === 0 ? 0 : 1)
}

function setFixedTmjHotspots(tmj: TiledMapRecord, world: WorldConfig) {
  const layer = tmj.layers?.find((item) => item.type === 'objectgroup' && item.name === 'interactive_objects')
  if (!layer) {
    return
  }

  let nextObjectId = getNextObjectId(tmj)
  layer.objects = world.hotspots.map((hotspot) => {
    const bounds = fixedHotspotBounds(hotspot)
    const anchor = percentPoint(hotspot.x, hotspot.y)
    return {
      id: nextObjectId++,
      name: hotspot.label,
      type: '',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rotation: 0,
      visible: true,
      properties: [
        { name: 'objectId', type: 'string', value: hotspot.id },
        { name: 'interactions', type: 'string', value: JSON.stringify([{ id: `${hotspot.id}-interaction`, name: hotspot.actionLabel }]) },
        { name: 'source', type: 'string', value: fixedHotspotSource },
        { name: 'anchorX', type: 'float', value: anchor.x },
        { name: 'anchorY', type: 'float', value: anchor.y },
        { name: 'kind', type: 'string', value: hotspot.kind },
      ],
    }
  })
  tmj.nextobjectid = Math.max(Number(tmj.nextobjectid ?? 1), nextObjectId)
}

async function runCharacterPipeline(config: {
  targetDir: string
  workDir: string
  description: string
  name: string
  role: string
  world: WorldConfig
  outputJsonName: string
  mode: 'player-frames' | 'image' | 'spritesheet'
  promptTemplate?: string
  imageKind?: 'agent' | 'prop'
  force?: boolean
}) {
  const backupDir = config.force ? backupExistingAssetDir(config.targetDir) : null
  try {
    return await runCharacterPipelineOnce(config, backupDir)
  } catch (error) {
    restoreAssetDirBackup(config.targetDir, backupDir)
    throw error
  }
}

async function runCharacterPipelineOnce(config: {
  targetDir: string
  workDir: string
  description: string
  name: string
  role: string
  world: WorldConfig
  outputJsonName: string
  mode: 'player-frames' | 'image' | 'spritesheet'
  promptTemplate?: string
  imageKind?: 'agent' | 'prop'
  force?: boolean
}, backupDir: string | null) {
  if (config.force) {
    fs.rmSync(config.targetDir, { recursive: true, force: true })
  }
  const reusableSprite = readReusableSprite(config.targetDir, config.mode)
  if (reusableSprite) {
    console.log(`[fixed-assets] Reusing existing ${config.mode} asset: ${config.targetDir}`)
    removeAssetDirBackup(backupDir)
    return reusableSprite
  }

  const charOutputDir = path.join(config.workDir, 'characters')
  fs.mkdirSync(charOutputDir, { recursive: true })
  const imageEnv = buildCharacterImageEnv(config.mode)
  const sourceCharacterDir = config.mode === 'player-frames' && options.sourceCharacterDir
    ? path.resolve(repoRoot, options.sourceCharacterDir)
    : null

  if (sourceCharacterDir) {
    assertCharacterOutputDir(sourceCharacterDir)
    console.log(`[fixed-assets] Reusing character output for player: ${sourceCharacterDir}`)
  } else if (config.mode === 'player-frames' && imageEnv.IMAGE_GEN_MODEL) {
    console.log(`[fixed-assets] Player image model override: ${imageEnv.IMAGE_GEN_MODEL}`)
  }

  if (!sourceCharacterDir) {
    runCommand(process.execPath, [
      path.join(repoRoot, 'generators/character/src/index.mjs'),
      config.description,
      '--name',
      config.name,
      '--role',
      config.role,
      '--world-visual-context',
      `${config.world.title}。${config.world.atmosphere}。资源会叠加到固定导航模板地图上，底部中心对齐固定热点坐标，不能自带房间背景或定位标记。`,
      '--prompt-template',
      config.promptTemplate ?? 'generate-sprite.md',
      '--output-json',
      config.outputJsonName,
    ], {
      CHAR_OUTPUT_DIR: charOutputDir,
      CHROMAKEY_HARD_THRESHOLD: '80',
      CHROMAKEY_SOFT_THRESHOLD: '140',
      ...imageEnv,
    })
  }

  const latestCharacterDir = sourceCharacterDir ?? getLatestChildDir(charOutputDir)
  if (config.mode === 'player-frames') {
    const sprite = await splitPlayerSheetToFrames(latestCharacterDir, config.targetDir)
    removeAssetDirBackup(backupDir)
    return sprite
  }

  if (config.mode === 'image') {
    const sprite = await processSingleImage(latestCharacterDir, config.targetDir, config.imageKind ?? 'agent')
    removeAssetDirBackup(backupDir)
    return sprite
  }

  fs.mkdirSync(config.targetDir, { recursive: true })
  copyRequired(path.join(latestCharacterDir, 'spritesheet.png'), path.join(config.targetDir, 'spritesheet.png'))
  copyRequired(path.join(latestCharacterDir, 'metadata.json'), path.join(config.targetDir, 'metadata.json'))
  const metadata = JSON.parse(fs.readFileSync(path.join(config.targetDir, 'metadata.json'), 'utf-8'))
  const sprite = propSprite(pathToPublicAsset(path.join(config.targetDir, 'spritesheet.png')), metadata)
  removeAssetDirBackup(backupDir)
  return sprite
}

function buildCharacterImageEnv(mode: 'player-frames' | 'image' | 'spritesheet') {
  if (mode !== 'player-frames') {
    return {}
  }

  return Object.fromEntries([
    ['IMAGE_GEN_PROVIDER', process.env.PLAYER_IMAGE_GEN_PROVIDER],
    ['IMAGE_GEN_BASE_URL', process.env.PLAYER_IMAGE_GEN_BASE_URL],
    ['IMAGE_GEN_API_KEY', process.env.PLAYER_IMAGE_GEN_API_KEY],
    ['IMAGE_GEN_MODEL', process.env.PLAYER_IMAGE_GEN_MODEL],
    ['IMAGE_GEN_TIMEOUT_MS', process.env.PLAYER_IMAGE_GEN_TIMEOUT_MS],
    ['IMAGE_GEN_MAX_RETRIES', process.env.PLAYER_IMAGE_GEN_MAX_RETRIES],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])))
}

function assertCharacterOutputDir(sourceCharacterDir: string) {
  for (const fileName of ['spritesheet.png', 'metadata.json']) {
    if (!fs.existsSync(path.join(sourceCharacterDir, fileName))) {
      throw new Error(`--source-character-dir is missing ${fileName}: ${sourceCharacterDir}`)
    }
  }
}

function backupExistingAssetDir(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    return null
  }

  const backupDir = `${targetDir}.backup-${runId}`
  fs.rmSync(backupDir, { recursive: true, force: true })
  fs.renameSync(targetDir, backupDir)
  return backupDir
}

function restoreAssetDirBackup(targetDir: string, backupDir: string | null) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    return
  }

  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.renameSync(backupDir, targetDir)
}

function removeAssetDirBackup(backupDir: string | null) {
  if (backupDir) {
    fs.rmSync(backupDir, { recursive: true, force: true })
  }
}

function readReusableSprite(targetDir: string, mode: 'player-frames' | 'image' | 'spritesheet') {
  const metadataPath = path.join(targetDir, 'metadata.json')
  if (!fs.existsSync(metadataPath)) {
    return null
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
  if (metadata.qualityStatus?.status === 'failed') {
    return null
  }

  if (mode === 'player-frames') {
    if (metadata.layout !== 'player-8dir-8x8-v1') {
      return null
    }
    if (!fs.existsSync(path.join(targetDir, 'frame_000.png'))) {
      return null
    }
    if (!fs.existsSync(path.join(targetDir, 'frame_063.png'))) {
      return null
    }
    return frameSprite(pathToPublicAsset(targetDir), metadata)
  }

  if (mode === 'image') {
    const imagePath = path.join(targetDir, 'image.png')
    if (!fs.existsSync(imagePath)) {
      return null
    }
    return imageSprite(pathToPublicAsset(imagePath), metadata, metadata.kind === 'prop' ? 'prop' : 'agent')
  }

  const spritesheetPath = path.join(targetDir, 'spritesheet.png')
  if (!fs.existsSync(spritesheetPath)) {
    return null
  }
  return propSprite(pathToPublicAsset(spritesheetPath), metadata)
}

async function splitPlayerSheetToFrames(sourceDir: string, targetDir: string): Promise<GeneratedSpriteAsset> {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const fileName of fs.readdirSync(targetDir)) {
    if (/^frame_\\d+\\.png$/.test(fileName)) {
      fs.rmSync(path.join(targetDir, fileName), { force: true })
    }
  }
  const rawSheetPath = path.join(sourceDir, 'spritesheet-raw.png')
  const sheetPath = fs.existsSync(rawSheetPath) ? rawSheetPath : path.join(sourceDir, 'spritesheet.png')
  const metadataPath = path.join(sourceDir, 'metadata.json')
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
  const columns = 8
  const rows = 8
  const frameWidth = 256
  const frameHeight = 256
  const frameCount = columns * rows
  const cleanedSheet = await removeConnectedGreenBackground(fs.readFileSync(sheetPath))
  const normalizedSheet = await sharp(cleanedSheet)
    .resize(columns * frameWidth, rows * frameHeight, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer()
  const detectedGrid = await detectPlayerGrid(normalizedSheet, columns, rows, frameWidth, frameHeight)
  const issues: string[] = []
  const rawFrameBoxes: PlayerFrameBox[] = []

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameLabel = `frame_${String(frameIndex).padStart(3, '0')}`
    const column = frameIndex % columns
    const row = Math.floor(frameIndex / columns)
    const frameBuffer = await extractCenteredFrame(normalizedSheet, {
      centerX: detectedGrid.xCenters[column],
      centerY: detectedGrid.yCenters[row],
      width: frameWidth,
      height: frameHeight,
      sheetWidth: columns * frameWidth,
      sheetHeight: rows * frameHeight,
    })
    const cleanedFrameBuffer = await removePlayerFrameBackground(frameBuffer)
    const rawBox = await findAlphaBoundingBox(cleanedFrameBuffer)
    issues.push(...validatePlayerRawCell(rawBox, frameLabel))
    if (rawBox) {
      rawFrameBoxes.push({
        frameIndex,
        subjectWidth: rawBox.right - rawBox.left + 1,
        subjectHeight: rawBox.bottom - rawBox.top + 1,
        centerX: (rawBox.left + rawBox.right) / 2,
        bottom: rawBox.bottom,
      })
    }
    const normalizedFrame = await normalizeSubjectBuffer(cleanedFrameBuffer, {
      canvasSize: 256,
      maxSubjectSize: 220,
      footY: 236,
    })
    issues.push(...await validateAlphaSubject(normalizedFrame, frameLabel))
    fs.writeFileSync(path.join(targetDir, `${frameLabel}.png`), normalizedFrame)
  }
  issues.push(...validatePlayerFrameSeries(rawFrameBoxes, frameCount, frameWidth, frameHeight))

  const qualityStatus = buildQualityStatus(issues)
  const nextMetadata = {
    ...metadata,
    sourceType: 'frames',
    layout: 'player-8dir-8x8-v1',
    frameWidth,
    frameHeight,
    columns,
    rows,
    frameCount,
    animations: playerAnimationMetadata(),
    segmentation: detectedGrid,
    qualityStatus,
  }
  writeJson(path.join(targetDir, 'metadata.json'), nextMetadata)

  if (qualityStatus.status === 'failed') {
    throw new Error(`player sheet quality check failed: ${qualityStatus.issues.slice(0, 6).join('; ')}`)
  }

  return frameSprite(pathToPublicAsset(targetDir), nextMetadata)
}

async function createProceduralPlayerFrames(world: WorldConfig, targetDir: string, fallbackReason: string): Promise<GeneratedSpriteAsset> {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const fileName of fs.readdirSync(targetDir)) {
    if (/^frame_\d+\.png$/.test(fileName)) {
      fs.rmSync(path.join(targetDir, fileName), { force: true })
    }
  }

  const palette = buildStylePack(world).palette
  const result = resultsById[world.id]
  const frameCount = 64
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const row = Math.floor(frameIndex / 8)
    const column = frameIndex % 8
    const svg = buildProceduralPlayerSvg(row, column, palette)
    await sharp(Buffer.from(svg)).png().toFile(path.join(targetDir, `frame_${String(frameIndex).padStart(3, '0')}.png`))
  }

  const metadata = {
    id: `procedural-${world.id.toLowerCase()}-player`,
    name: `${world.id} Procedural Player`,
    description: `${result.name} procedural fallback player frames`,
    createdAt: new Date().toISOString(),
    sourceType: 'frames',
    layout: 'player-8dir-8x8-v1',
    frameWidth: 256,
    frameHeight: 256,
    columns: 8,
    rows: 8,
    frameCount,
    frameIndex: 0,
    scale: 0.58,
    animations: playerAnimationMetadata(),
    generator: 'procedural-player-fallback-v1',
    fallbackReason,
    qualityStatus: buildQualityStatus([]),
  }
  writeJson(path.join(targetDir, 'metadata.json'), metadata)
  return frameSprite(pathToPublicAsset(targetDir), metadata)
}

function buildProceduralPlayerSvg(
  directionRow: number,
  frameColumn: number,
  palette: CompositePalette,
) {
  const stepCycle = [0, 1, 2, 1, 0, -1, -2, -1][frameColumn] ?? 0
  const bob = Math.abs(stepCycle) * -2
  const facingLeft = directionRow === 1 || directionRow === 2 || directionRow === 3
  const facingRight = directionRow === 5 || directionRow === 6 || directionRow === 7
  const facingBack = directionRow === 3 || directionRow === 4 || directionRow === 5
  const faceOffset = facingLeft ? -7 : facingRight ? 7 : 0
  const armSwing = stepCycle * 4
  const leftLeg = 112 + stepCycle * 3
  const rightLeg = 136 - stepCycle * 3
  const skin = '#f2c5a0'
  const outline = '#1a1320'
  const shoe = palette.shadow
  const body = palette.accent
  const bodyDark = palette.wall
  const trim = palette.trim
  const glow = palette.glow
  const hair = palette.blocked

  return [
    '<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">',
    '<rect width="256" height="256" fill="none"/>',
    `<ellipse cx="128" cy="226" rx="43" ry="12" fill="${outline}" opacity="0.22"/>`,
    `<g transform="translate(0 ${bob})">`,
    `<rect x="${leftLeg}" y="169" width="18" height="50" rx="8" fill="${bodyDark}" stroke="${outline}" stroke-width="6"/>`,
    `<rect x="${rightLeg}" y="169" width="18" height="50" rx="8" fill="${bodyDark}" stroke="${outline}" stroke-width="6"/>`,
    `<ellipse cx="${leftLeg + 9}" cy="220" rx="16" ry="8" fill="${shoe}" stroke="${outline}" stroke-width="5"/>`,
    `<ellipse cx="${rightLeg + 9}" cy="220" rx="16" ry="8" fill="${shoe}" stroke="${outline}" stroke-width="5"/>`,
    `<rect x="${84 - armSwing * 0.2}" y="112" width="28" height="72" rx="14" fill="${bodyDark}" stroke="${outline}" stroke-width="6" transform="rotate(${-8 - armSwing} ${98 - armSwing * 0.2} 148)"/>`,
    `<rect x="${144 + armSwing * 0.2}" y="112" width="28" height="72" rx="14" fill="${bodyDark}" stroke="${outline}" stroke-width="6" transform="rotate(${8 + armSwing} ${158 + armSwing * 0.2} 148)"/>`,
    `<rect x="89" y="102" width="78" height="86" rx="28" fill="${body}" stroke="${outline}" stroke-width="7"/>`,
    `<path d="M100 124 C116 136 140 136 156 124 L160 176 C140 188 116 188 96 176 Z" fill="${trim}" opacity="0.28"/>`,
    `<circle cx="128" cy="92" r="42" fill="${bodyDark}" stroke="${outline}" stroke-width="7"/>`,
    `<circle cx="128" cy="88" r="32" fill="${skin}" stroke="${outline}" stroke-width="6"/>`,
    facingBack
      ? `<path d="M96 87 C106 54 151 54 160 88 C151 80 106 80 96 87 Z" fill="${hair}"/><path d="M102 104 C116 116 140 116 154 104" stroke="${trim}" stroke-opacity="0.42" stroke-width="6" fill="none" stroke-linecap="round"/>`
      : `<path d="M97 82 C105 50 151 50 159 82 C143 72 113 72 97 82 Z" fill="${hair}"/><circle cx="${117 + faceOffset}" cy="91" r="4" fill="${outline}"/><circle cx="${139 + faceOffset}" cy="91" r="4" fill="${outline}"/><path d="M119 ${109 + Math.abs(stepCycle)} C126 114 135 114 142 ${109 + Math.abs(stepCycle)}" stroke="${outline}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    `<circle cx="${144 + faceOffset * 0.3}" cy="142" r="7" fill="${glow}" stroke="${outline}" stroke-width="4"/>`,
    `<path d="M104 153 H152" stroke="${outline}" stroke-opacity="0.2" stroke-width="5" stroke-linecap="round"/>`,
    '</g>',
    '</svg>',
  ].join('')
}

async function processSingleImage(sourceDir: string, targetDir: string, kind: 'agent' | 'prop'): Promise<GeneratedSpriteAsset> {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.rmSync(path.join(targetDir, 'frames'), { recursive: true, force: true })
  fs.rmSync(path.join(targetDir, 'spritesheet.png'), { force: true })
  const sourcePath = path.join(sourceDir, 'spritesheet.png')
  const sourceMetadataPath = path.join(sourceDir, 'metadata.json')
  const sourceMetadata = JSON.parse(fs.readFileSync(sourceMetadataPath, 'utf-8'))
  const imageBuffer = await normalizeSingleImage(sourcePath)
  const issues = await validateAlphaSubject(imageBuffer, `${kind} image`)
  const qualityStatus = buildQualityStatus(issues)
  const imagePath = path.join(targetDir, 'image.png')
  fs.writeFileSync(imagePath, imageBuffer)

  const metadata = {
    ...sourceMetadata,
    kind,
    sourceType: 'image',
    layout: 'single-image-v1',
    frameWidth: 512,
    frameHeight: 512,
    columns: 1,
    rows: 1,
    frameCount: 1,
    frameIndex: 0,
    qualityStatus,
  }
  writeJson(path.join(targetDir, 'metadata.json'), metadata)

  if (qualityStatus.status === 'failed') {
    throw new Error(`${kind} image quality check failed: ${qualityStatus.issues.join('; ')}`)
  }

  return imageSprite(pathToPublicAsset(imagePath), metadata, kind)
}

function updateHotspotSprite(manifest: PersonalityAssetManifest, hotspotId: string, sprite: GeneratedSpriteAsset) {
  manifest.hotspots = manifest.hotspots.map((hotspot) => hotspot.id === hotspotId ? { ...hotspot, sprite } : hotspot)
  const hotspot = manifest.hotspots.find((item) => item.id === hotspotId)
  if (!hotspot) {
    return
  }
  if (hotspot.kind === 'npc') {
    manifest.agents[hotspotId] = hotspot
  } else {
    manifest.props[hotspotId] = hotspot
  }
}

function loadGenerationStatus(targetDir: string, archetypeId: ArchetypeId): GenerationStatus {
  const statusPath = path.join(targetDir, 'generation-status.json')
  if (fs.existsSync(statusPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as GenerationStatus
      return {
        ...existing,
        runId,
        outputDir: targetDir,
        updatedAt: new Date().toISOString(),
        assets: existing.assets ?? {},
      }
    } catch {
      // Fall through to recreate a clean status file.
    }
  }

  const now = new Date().toISOString()
  return {
    archetypeId,
    runId,
    outputDir: targetDir,
    startedAt: now,
    updatedAt: now,
    assets: {},
  }
}

function markAssetStatus(
  status: GenerationStatus,
  targetDir: string,
  assetId: string,
  assetStatus: 'completed' | 'failed' | 'pending',
  extra: { path?: string; error?: string } = {},
) {
  status.updatedAt = new Date().toISOString()
  status.assets[assetId] = {
    status: assetStatus,
    path: extra.path,
    error: extra.error,
    updatedAt: status.updatedAt,
  }
  writeGenerationStatus(targetDir, status)
}

function writeGenerationStatus(targetDir: string, status: GenerationStatus) {
  status.updatedAt = new Date().toISOString()
  writeJson(path.join(targetDir, 'generation-status.json'), status)
}

function reconcileManifestAssets(manifest: PersonalityAssetManifest, targetDir: string): PersonalityAssetManifest {
  const next = JSON.parse(JSON.stringify(manifest)) as PersonalityAssetManifest

  if (next.player?.sprite) {
    if (!spriteAssetExists(targetDir, next, next.player.sprite)) {
      delete next.player.sprite
    } else {
      next.player.sprite = hydrateSpriteFromMetadata(targetDir, next, next.player.sprite)
    }
  }
  if (next.player?.promptPath && !manifestAssetExists(targetDir, next, next.player.promptPath)) {
    delete next.player.promptPath
  }

  next.hotspots = next.hotspots.map((hotspot) => {
    const normalized = { ...hotspot }
    if (normalized.sprite) {
      if (!spriteAssetExists(targetDir, next, normalized.sprite)) {
        delete normalized.sprite
      } else {
        normalized.sprite = hydrateSpriteFromMetadata(targetDir, next, normalized.sprite)
      }
    }
    if (normalized.systemPromptPath && !manifestAssetExists(targetDir, next, normalized.systemPromptPath)) {
      delete normalized.systemPromptPath
    }
    return normalized
  })
  next.agents = Object.fromEntries(next.hotspots.filter((hotspot) => hotspot.kind === 'npc').map((hotspot) => [hotspot.id, hotspot]))
  next.props = Object.fromEntries(next.hotspots.filter((hotspot) => hotspot.kind === 'object').map((hotspot) => [hotspot.id, hotspot]))

  return next
}

function hydrateSpriteFromMetadata(targetDir: string, manifest: PersonalityAssetManifest, sprite: GeneratedSpriteAsset): GeneratedSpriteAsset {
  const metadataAssetPath = sprite.sourceType === 'frames' && sprite.framesDir
    ? `${sprite.framesDir}/metadata.json`
    : sprite.imagePath
      ? `${path.posix.dirname(sprite.imagePath)}/metadata.json`
      : null
  if (!metadataAssetPath) {
    return sprite
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(resolveManifestAssetPath(targetDir, manifest, metadataAssetPath), 'utf-8')) as Partial<GeneratedSpriteAsset>
    const animations = metadata.animations?.walkDown || metadata.animations?.walkLeft
      ? metadata.animations
      : sprite.animations
    return {
      ...sprite,
      frameCount: metadata.frameCount ?? sprite.frameCount,
      frameWidth: metadata.frameWidth ?? sprite.frameWidth,
      frameHeight: metadata.frameHeight ?? sprite.frameHeight,
      columns: metadata.columns ?? sprite.columns,
      rows: metadata.rows ?? sprite.rows,
      frameIndex: metadata.frameIndex ?? sprite.frameIndex,
      layout: metadata.layout ?? sprite.layout,
      qualityStatus: metadata.qualityStatus ?? sprite.qualityStatus,
      animations,
    }
  } catch {
    return sprite
  }
}

function spriteAssetExists(targetDir: string, manifest: PersonalityAssetManifest, sprite: GeneratedSpriteAsset) {
  if (sprite.sourceType === 'frames') {
    return Boolean(sprite.framesDir) &&
      manifestAssetExists(targetDir, manifest, `${sprite.framesDir}/frame_000.png`) &&
      manifestAssetExists(targetDir, manifest, `${sprite.framesDir}/metadata.json`) &&
      spriteMetadataIsUsable(targetDir, manifest, `${sprite.framesDir}/metadata.json`)
  }

  if (sprite.sourceType === 'image') {
    return Boolean(sprite.imagePath) &&
      manifestAssetExists(targetDir, manifest, sprite.imagePath) &&
      manifestAssetExists(targetDir, manifest, `${path.posix.dirname(sprite.imagePath)}/metadata.json`) &&
      spriteMetadataIsUsable(targetDir, manifest, `${path.posix.dirname(sprite.imagePath)}/metadata.json`)
  }

  return Boolean(sprite.imagePath) && manifestAssetExists(targetDir, manifest, sprite.imagePath)
}

function spriteMetadataIsUsable(targetDir: string, manifest: PersonalityAssetManifest, metadataAssetPath: string) {
  try {
    const metadata = JSON.parse(fs.readFileSync(resolveManifestAssetPath(targetDir, manifest, metadataAssetPath), 'utf-8'))
    return metadata.qualityStatus?.status !== 'failed'
  } catch {
    return false
  }
}

function manifestAssetExists(targetDir: string, manifest: PersonalityAssetManifest, assetPath: string) {
  return fs.existsSync(resolveManifestAssetPath(targetDir, manifest, assetPath))
}

function resolveManifestAssetPath(targetDir: string, manifest: PersonalityAssetManifest, assetPath: string) {
  const normalized = assetPath.replace(/^\/+/, '')
  const prefix = `personality-assets/fixed/${manifest.archetypeId.toLowerCase()}/`
  if (normalized.startsWith(prefix)) {
    return path.join(targetDir, normalized.slice(prefix.length))
  }
  return path.join(repoRoot, 'client/public', normalized)
}

function hasMapAssets(targetDir: string) {
  return fs.existsSync(path.join(targetDir, 'map/background.png')) &&
    fs.existsSync(path.join(targetDir, 'map/map.tmj')) &&
    fs.existsSync(path.join(targetDir, 'map/walkable-grid.json'))
}

async function normalizeSingleImage(sourcePath: string) {
  const source = await sharp(sourcePath)
    .ensureAlpha()
    .png()
    .toBuffer()
  return normalizeSubjectBuffer(source, {
    canvasSize: 512,
    maxSubjectSize: 384,
  })
}

async function detectPlayerGrid(
  sheetBuffer: Buffer,
  columns: number,
  rows: number,
  frameWidth: number,
  frameHeight: number,
): Promise<DetectedPlayerGrid> {
  const { data, info } = await sharp(sheetBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const xProjection = new Array(info.width).fill(0)
  const yProjection = new Array(info.height).fill(0)

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      if (!isPlayerForegroundPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) {
        continue
      }
      xProjection[x] += 1
      yProjection[y] += 1
    }
  }

  const xCenters = findProjectionCenters(xProjection, columns)
  const yCenters = findProjectionCenters(yProjection, rows)
  if (xCenters.length === columns && yCenters.length === rows) {
    return { xCenters, yCenters, method: 'detected-centers-v1' }
  }

  return {
    xCenters: Array.from({ length: columns }, (_unused, index) => frameWidth / 2 + index * frameWidth),
    yCenters: Array.from({ length: rows }, (_unused, index) => frameHeight / 2 + index * frameHeight),
    method: 'equal-grid-fallback-v1',
  }
}

function findProjectionCenters(projection: number[], expectedCount: number) {
  const max = Math.max(...projection)
  if (max <= 0) {
    return []
  }
  const threshold = Math.max(6, max * 0.08)
  const runs: Array<{ start: number; end: number; center: number; weight: number }> = []
  let start = -1
  let weightedSum = 0
  let weight = 0

  for (let index = 0; index < projection.length; index += 1) {
    const value = projection[index]
    if (value >= threshold) {
      if (start < 0) {
        start = index
      }
      weightedSum += index * value
      weight += value
      continue
    }

    if (start >= 0) {
      runs.push({ start, end: index - 1, center: weightedSum / weight, weight })
      start = -1
      weightedSum = 0
      weight = 0
    }
  }

  if (start >= 0) {
    runs.push({ start, end: projection.length - 1, center: weightedSum / weight, weight })
  }

  const meaningfulRuns = runs.filter((run) => run.end - run.start >= 5)
  if (meaningfulRuns.length < expectedCount) {
    return []
  }

  return meaningfulRuns
    .sort((a, b) => b.weight - a.weight)
    .slice(0, expectedCount)
    .sort((a, b) => a.center - b.center)
    .map((run) => Math.round(run.center))
}

async function extractCenteredFrame(
  sheetBuffer: Buffer,
  config: {
    centerX: number
    centerY: number
    width: number
    height: number
    sheetWidth: number
    sheetHeight: number
  },
) {
  const left = Math.round(config.centerX - config.width / 2)
  const top = Math.round(config.centerY - config.height / 2)
  const sourceLeft = Math.max(0, left)
  const sourceTop = Math.max(0, top)
  const sourceRight = Math.min(config.sheetWidth, left + config.width)
  const sourceBottom = Math.min(config.sheetHeight, top + config.height)
  const sourceWidth = Math.max(1, sourceRight - sourceLeft)
  const sourceHeight = Math.max(1, sourceBottom - sourceTop)
  const source = await sharp(sheetBuffer)
    .extract({ left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight })
    .ensureAlpha()
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: config.width,
      height: config.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: source, left: sourceLeft - left, top: sourceTop - top }])
    .png()
    .toBuffer()
}

async function removePlayerFrameBackground(buffer: Buffer) {
  const connectedCleaned = await removeConnectedGreenBackground(buffer)
  const despilled = await removeGreenDominantPixels(connectedCleaned)
  return removeSmallAlphaComponents(despilled)
}

async function removeConnectedGreenBackground(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(data)
  const { width, height, channels } = info
  const bgColor = detectEdgeBackgroundColor(pixels, width, height, channels)
  const hardThreshold = 118
  const softThreshold = 230
  const state = new Uint8Array(width * height)
  const queue: number[] = []
  const index = (x: number, y: number) => y * width + x
  const pixelIndex = (x: number, y: number) => (y * width + x) * channels
  const distanceAt = (x: number, y: number) => {
    const offset = pixelIndex(x, y)
    return colorDistance(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      bgColor.r,
      bgColor.g,
      bgColor.b,
    )
  }
  const visitBackground = (x: number, y: number) => {
    const distance = distanceAt(x, y)
    if (distance >= softThreshold) {
      return
    }
    const stateIndex = index(x, y)
    state[stateIndex] = distance < hardThreshold ? 1 : 2
    queue.push(x, y)
  }

  for (let x = 0; x < width; x += 1) {
    visitBackground(x, 0)
    visitBackground(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    visitBackground(0, y)
    visitBackground(width - 1, y)
  }

  let queueIndex = 0
  const neighbours = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  while (queueIndex < queue.length) {
    const x = queue[queueIndex]
    const y = queue[queueIndex + 1]
    queueIndex += 2

    for (const offset of neighbours) {
      const nextX = x + offset.x
      const nextY = y + offset.y
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue
      }
      const stateIndex = index(nextX, nextY)
      if (state[stateIndex] !== 0) {
        continue
      }
      const distance = distanceAt(nextX, nextY)
      if (distance < softThreshold) {
        state[stateIndex] = distance < hardThreshold ? 1 : 2
        queue.push(nextX, nextY)
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const stateValue = state[index(x, y)]
      if (stateValue === 0) {
        continue
      }
      const offset = pixelIndex(x, y)
      if (stateValue === 1) {
        pixels[offset + 3] = 0
        continue
      }
      const distance = distanceAt(x, y)
      const alphaRatio = Math.max(0, Math.min(1, (distance - hardThreshold) / (softThreshold - hardThreshold)))
      pixels[offset + 3] = Math.min(pixels[offset + 3], Math.round(255 * alphaRatio))
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels },
  }).png().toBuffer()
}

async function removeGreenDominantPixels(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(data)

  for (let offset = 0; offset < pixels.length; offset += info.channels) {
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const alpha = pixels[offset + 3]
    if (alpha <= 0) {
      continue
    }
    if (isGreenScreenPixel(red, green, blue)) {
      pixels[offset + 3] = 0
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png().toBuffer()
}

async function removeSmallAlphaComponents(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(data)
  const pixelCount = info.width * info.height
  const visited = new Uint8Array(pixelCount)
  const components: Array<{ pixels: number[]; area: number }> = []
  const neighbours = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]
  const index = (x: number, y: number) => y * info.width + x

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const startIndex = index(x, y)
      if (visited[startIndex] || pixels[startIndex * info.channels + 3] <= 20) {
        continue
      }

      const queue = [startIndex]
      const componentPixels: number[] = []
      visited[startIndex] = 1
      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const current = queue[queueIndex]
        componentPixels.push(current)
        const currentX = current % info.width
        const currentY = Math.floor(current / info.width)
        for (const offset of neighbours) {
          const nextX = currentX + offset.x
          const nextY = currentY + offset.y
          if (nextX < 0 || nextY < 0 || nextX >= info.width || nextY >= info.height) {
            continue
          }
          const nextIndex = index(nextX, nextY)
          if (visited[nextIndex] || pixels[nextIndex * info.channels + 3] <= 20) {
            continue
          }
          visited[nextIndex] = 1
          queue.push(nextIndex)
        }
      }
      components.push({ pixels: componentPixels, area: componentPixels.length })
    }
  }

  if (components.length <= 1) {
    return buffer
  }

  const largestArea = Math.max(...components.map((component) => component.area))
  const minimumArea = Math.max(32, Math.round(largestArea * 0.012))
  for (const component of components) {
    if (component.area >= minimumArea) {
      continue
    }
    for (const pixelIndex of component.pixels) {
      pixels[pixelIndex * info.channels + 3] = 0
    }
  }

  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png().toBuffer()
}

function isPlayerForegroundPixel(red: number, green: number, blue: number, alpha: number) {
  return alpha > 35 && !isGreenScreenPixel(red, green, blue)
}

function isGreenScreenPixel(red: number, green: number, blue: number) {
  return green > 70 && green > red * 1.08 && green > blue * 1.08
}

function detectEdgeBackgroundColor(pixels: Uint8Array, width: number, height: number, channels: number) {
  const samples: Array<{ x: number; y: number }> = []
  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.025))
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 24))) {
    samples.push({ x, y: margin }, { x, y: height - margin - 1 })
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 24))) {
    samples.push({ x: margin, y }, { x: width - margin - 1, y })
  }

  let r = 0
  let g = 0
  let b = 0
  for (const sample of samples) {
    const offset = (sample.y * width + sample.x) * channels
    r += pixels[offset]
    g += pixels[offset + 1]
    b += pixels[offset + 2]
  }
  const count = Math.max(1, samples.length)
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  }
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

async function normalizeSubjectBuffer(buffer: Buffer, config: {
  canvasSize: number
  maxSubjectSize: number
  footY?: number
}) {
  const bbox = await findAlphaBoundingBox(buffer)
  if (!bbox) {
    return sharp({
      create: {
        width: config.canvasSize,
        height: config.canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer()
  }

  const extracted = await sharp(buffer)
    .extract({
      left: bbox.left,
      top: bbox.top,
      width: bbox.right - bbox.left + 1,
      height: bbox.bottom - bbox.top + 1,
    })
    .resize(config.maxSubjectSize, config.maxSubjectSize, {
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer()
  const resizedMeta = await sharp(extracted).metadata()
  const resizedWidth = Number(resizedMeta.width ?? 0)
  const resizedHeight = Number(resizedMeta.height ?? 0)
  const left = Math.floor((config.canvasSize - resizedWidth) / 2)
  const centeredTop = Math.floor((config.canvasSize - resizedHeight) / 2)
  const footAlignedTop = config.footY == null ? centeredTop : config.footY - resizedHeight
  const top = Math.max(0, Math.min(config.canvasSize - resizedHeight, footAlignedTop))

  return sharp({
    create: {
      width: config.canvasSize,
      height: config.canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: extracted, left, top }])
    .png()
    .toBuffer()
}

async function validateAlphaSubject(buffer: Buffer, label: string) {
  const bbox = await findAlphaBoundingBox(buffer)
  if (!bbox) {
    return [`${label}: empty transparent image`]
  }

  const width = bbox.imageWidth
  const height = bbox.imageHeight
  const subjectWidth = bbox.right - bbox.left + 1
  const subjectHeight = bbox.bottom - bbox.top + 1
  const areaRatio = bbox.opaquePixels / (width * height)
  const issues: string[] = []
  const edgeMargin = Math.max(3, Math.round(Math.min(width, height) * 0.02))

  if (areaRatio < 0.006) {
    issues.push(`${label}: subject is too small or nearly empty`)
  }
  if (areaRatio > 0.68) {
    issues.push(`${label}: subject/background fill is too dense`)
  }
  if (bbox.left <= edgeMargin || bbox.top <= edgeMargin || width - bbox.right - 1 <= edgeMargin || height - bbox.bottom - 1 <= edgeMargin) {
    issues.push(`${label}: subject touches or nearly touches the crop edge`)
  }
  if (subjectWidth / width > 0.9 || subjectHeight / height > 0.9) {
    issues.push(`${label}: subject likely cropped or too large for its cell`)
  }
  if (subjectWidth / width < 0.12 || subjectHeight / height < 0.16) {
    issues.push(`${label}: subject is too small for gameplay readability`)
  }

  const centerX = (bbox.left + bbox.right) / 2
  const centerY = (bbox.top + bbox.bottom) / 2
  if (Math.abs(centerX - width / 2) > width * 0.25 || Math.abs(centerY - height / 2) > height * 0.28) {
    issues.push(`${label}: subject is noticeably off-center`)
  }

  return issues
}

function validatePlayerRawCell(bbox: Awaited<ReturnType<typeof findAlphaBoundingBox>>, label: string) {
  if (!bbox) {
    return [`${label}: empty source cell before normalization`]
  }

  const width = bbox.imageWidth
  const height = bbox.imageHeight
  const subjectWidth = bbox.right - bbox.left + 1
  const subjectHeight = bbox.bottom - bbox.top + 1
  const issues: string[] = []
  const minMargin = Math.round(Math.min(width, height) * 0.025)

  if (
    bbox.left <= minMargin ||
    bbox.top <= minMargin ||
    width - bbox.right - 1 <= minMargin ||
    height - bbox.bottom - 1 <= minMargin
  ) {
    issues.push(`${label}: source cell subject is too close to an edge; likely cropped or crossing cells`)
  }
  if (subjectWidth / width > 0.92 || subjectHeight / height > 0.92) {
    issues.push(`${label}: source cell subject is too large for reliable frame cutting`)
  }
  if (subjectWidth / width < 0.14 || subjectHeight / height < 0.18) {
    issues.push(`${label}: source cell subject is too small before normalization`)
  }

  return issues
}

function validatePlayerFrameSeries(
  boxes: PlayerFrameBox[],
  expectedCount: number,
  frameWidth: number,
  frameHeight: number,
) {
  const issues: string[] = []
  if (boxes.length !== expectedCount) {
    issues.push(`player sheet: expected ${expectedCount} non-empty source cells, found ${boxes.length}`)
    return issues
  }

  const medianHeight = median(boxes.map((box) => box.subjectHeight))
  const heightOutliers = boxes.filter((box) => Math.abs(box.subjectHeight - medianHeight) > frameHeight * 0.24)
  if (heightOutliers.length > 8) {
    issues.push(`player sheet: ${heightOutliers.length} frames have inconsistent source character height`)
  }

  const bottomValues = boxes.map((box) => box.bottom)
  const bottomSpread = Math.max(...bottomValues) - Math.min(...bottomValues)
  if (bottomSpread > frameHeight * 0.28) {
    issues.push(`player sheet: source foot baseline drifts too much (${Math.round(bottomSpread)}px)`)
  }

  const centerValues = boxes.map((box) => box.centerX)
  const centerSpread = Math.max(...centerValues) - Math.min(...centerValues)
  if (centerSpread > frameWidth * 0.46) {
    issues.push(`player sheet: source character centers drift too much across cells (${Math.round(centerSpread)}px)`)
  }

  return issues
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) {
    return 0
  }
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

async function findAlphaBoundingBox(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  let opaquePixels = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3]
      if (alpha <= 20) {
        continue
      }
      opaquePixels += 1
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }

  if (opaquePixels === 0) {
    return null
  }

  return {
    left,
    right,
    top,
    bottom,
    opaquePixels,
    imageWidth: width,
    imageHeight: height,
  }
}

function buildQualityStatus(issues: string[]) {
  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
    checkedAt: new Date().toISOString(),
  } satisfies GeneratedSpriteAsset['qualityStatus']
}

function playerAnimationMetadata() {
  return {
    walkDown: { start: 0, end: 7, frameRate: 10 },
    walkDownLeft: { start: 8, end: 15, frameRate: 10 },
    walkLeft: { start: 16, end: 23, frameRate: 10 },
    walkUpLeft: { start: 24, end: 31, frameRate: 10 },
    walkUp: { start: 32, end: 39, frameRate: 10 },
    walkUpRight: { start: 40, end: 47, frameRate: 10 },
    walkRight: { start: 48, end: 55, frameRate: 10 },
    walkDownRight: { start: 56, end: 63, frameRate: 10 },
    idleDown: 0,
    idleDownLeft: 8,
    idleLeft: 16,
    idleUpLeft: 24,
    idleUp: 32,
    idleUpRight: 40,
    idleRight: 48,
    idleDownRight: 56,
    idleFront: 0,
    idleBack: 32,
  }
}

function frameSprite(framesDir: string, metadata: Partial<GeneratedSpriteAsset> = {}): GeneratedSpriteAsset {
  return {
    sourceType: 'frames',
    framesDir,
    frameCount: metadata.frameCount ?? 64,
    frameWidth: metadata.frameWidth ?? 256,
    frameHeight: metadata.frameHeight ?? 256,
    columns: metadata.columns ?? 8,
    rows: metadata.rows ?? 8,
    frameIndex: metadata.frameIndex ?? 0,
    scale: metadata.scale ?? 0.58,
    layout: metadata.layout ?? 'player-8dir-8x8-v1',
    qualityStatus: metadata.qualityStatus,
    animations: metadata.animations ?? playerAnimationMetadata(),
  }
}

function imageSprite(imagePath: string, metadata: Partial<GeneratedSpriteAsset> = {}, kind: 'agent' | 'prop'): GeneratedSpriteAsset {
  return {
    sourceType: 'image',
    imagePath,
    frameWidth: metadata.frameWidth ?? 512,
    frameHeight: metadata.frameHeight ?? 512,
    columns: 1,
    rows: 1,
    frameCount: 1,
    frameIndex: 0,
    scale: metadata.scale ?? (kind === 'agent' ? 0.32 : 0.25),
    layout: metadata.layout ?? 'single-image-v1',
    qualityStatus: metadata.qualityStatus,
  }
}

function propSprite(imagePath: string, metadata: Partial<GeneratedSpriteAsset> = {}): GeneratedSpriteAsset {
  return {
    sourceType: 'spritesheet',
    imagePath,
    frameWidth: metadata.frameWidth ?? 209,
    frameHeight: metadata.frameHeight ?? 250,
    columns: metadata.columns ?? 6,
    rows: metadata.rows ?? 5,
    frameIndex: 18,
    scale: 0.42,
    layout: metadata.layout ?? 'legacy',
    qualityStatus: metadata.qualityStatus,
  }
}

function ensureAssetFolders(targetDir: string, world: WorldConfig) {
  fs.mkdirSync(path.join(targetDir, 'map'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'player/frames'), { recursive: true })
  for (const hotspot of world.hotspots) {
    fs.mkdirSync(path.join(targetDir, hotspot.kind === 'npc' ? 'agents' : 'props', hotspot.id), { recursive: true })
  }
}

function buildRoomSystemPrompt(world: WorldConfig) {
  return [
    `你是「人格出逃空间站」中 ${world.title} 的空间调度系统。`,
    '你的语气先轻微黑色幽默，再给用户留出温柔的余地。',
    '你不诊断、不说教、不提供医疗建议；你只负责把人格碎片、互动对象和空间氛围组织成一个可探索的房间。',
    `空间任务：${world.mission}`,
  ].join('\n')
}

function buildAgentSystemPrompt(world: WorldConfig, hotspot: WorldHotspot) {
  return [
    `你是「人格出逃空间站」中 ${world.title} 的互动 Agent：${hotspot.label}。`,
    `你的身份：${hotspot.agentPersona ?? hotspot.summary}`,
    `互动目标：${hotspot.dialogue?.taskDescription ?? hotspot.actionLabel}`,
    '回复要短，像空间站里的奇怪居民；允许好笑，但最后要温柔。',
    '不要离开当前人格空间设定，不要询问隐私，不要做现实诊断。',
  ].join('\n')
}

function buildMapPromptPreview(world: WorldConfig, roomDesign: RoomDesign) {
  return [
    '# Map Prompt Preview',
    '',
    roomDesign.mapDescription,
    '',
    '## Navigation Template Contract',
    '- map/navigation-template.png is generated before image generation.',
    '- Light connected floor must become the visible walkable floor/carpet/platform in the final map.',
    '- Dark areas must remain walls, furniture, soft decor, shadow, or blocked background.',
    '- Do not draw visible markers, circles, boxes, labels, coordinates, or debug overlays.',
    '',
    '## Hotspots',
    ...world.hotspots.map((hotspot) => `- ${hotspot.id}: ${hotspot.label}, ${hotspot.kind}, ${hotspot.x}%, ${hotspot.y}%`),
  ].join('\n')
}

function buildHotspotAssetPrompt(world: WorldConfig, hotspot: WorldHotspot) {
  const contract = hotspot.kind === 'npc'
    ? '输出：单帧完整全身互动 Agent 图片，透明背景或纯绿底，不要 spritesheet，不要多角色。'
    : '输出：单帧互动道具图片，透明背景或纯绿底，不要 spritesheet，不要多版本，不要动效序列。'
  return [
    `所属人格空间：${world.title}`,
    `互动点：${hotspot.label}`,
    `类型：${hotspot.kind === 'npc' ? '互动 Agent 人物形象单图' : '互动道具单图'}`,
    `固定摆放坐标：地图舞台的 ${hotspot.x}%, ${hotspot.y}%；最终 sprite 的底部中心会落在这个点，必须适合站在/摆在固定导航模板的可走地面或地毯边缘。`,
    `外观与性格：${hotspot.agentPersona ?? hotspot.summary}`,
    `互动反应：${hotspot.reaction}`,
    contract,
    '构图：单体完整居中，底部中心稳定，不要画底座标记、地面坐标、房间背景、阴影框、圆圈或 UI 标记。',
    '风格：竖屏像素人格空间，黑色幽默但温柔，和所属地图主题统一，无文字，透明背景或可抠绿底。',
  ].join('\n')
}

function buildPlayerAssetPrompt(world: WorldConfig) {
  const result = resultsById[world.id]
  return [
    `所属人格空间：${world.title}`,
    `人格：${result.name} / ${result.englishName}`,
    `主角定位：人格出逃空间站的用户化身，${result.scene.dressCode}`,
    `空间气质：${world.atmosphere}`,
    '输出：1024×1024 或其他正方形 PNG；8×8 数学切分 spritesheet，64 个等大格，八方向各 8 帧。',
    '格子契约：每格一个完整全身主角，脚底基线稳定，轮廓离格子边缘至少 18%，不要跨格、贴边、裁头、裁脚。',
    '方向顺序：down, down-left, left, up-left, up, up-right, right, down-right；每行 8 帧连续走路。',
    '背景：整张图统一纯绿 #00B000；不要场景、道具、文字、Logo、网格线、特效或多角色。',
    '风格：Q版 tiny 2D RPG 像素主角，轮廓清楚，小体量，适合 900×1600 竖屏地图移动，无品牌、无 IP 复刻。',
  ].join('\n')
}

function percentPoint(x: number, y: number) {
  return {
    x: Math.round((x / 100) * stage.width),
    y: Math.round((y / 100) * stage.height),
  }
}

function percentRect(x: number, y: number, width: number, height: number) {
  const center = percentPoint(x, y)
  const pixelWidth = Math.round((width / 100) * stage.width)
  const pixelHeight = Math.round((height / 100) * stage.height)
  return {
    x: Math.round(center.x - pixelWidth / 2),
    y: Math.round(center.y - pixelHeight / 2),
    width: pixelWidth,
    height: pixelHeight,
  }
}

function isBlockingDecoration(shape: WorldLayerShape) {
  return ['panel', 'tower', 'arch', 'console', 'booth'].includes(shape)
}

function buildDeterministicWalkableGrid(world: WorldConfig) {
  const grid = Array.from({ length: gridSpec.height }, () => Array.from({ length: gridSpec.width }, () => 1))
  const spawnPoint = percentPoint(world.spawn.x, world.spawn.y)
  const spawn = pixelToTile(spawnPoint)
  const hotspotTiles = world.hotspots.map((hotspot) => pixelToTile(percentPoint(hotspot.x, hotspot.y)))
  const anchors = [spawn, ...hotspotTiles]
  const minAnchorX = Math.min(...anchors.map((point) => point.x))
  const maxAnchorX = Math.max(...anchors.map((point) => point.x))
  const minAnchorY = Math.min(...anchors.map((point) => point.y))
  const maxAnchorY = Math.max(...anchors.map((point) => point.y))
  const safeLeft = Math.round(gridSpec.width * 0.08)
  const safeRight = gridSpec.width - safeLeft - 1
  const safeTop = Math.round(gridSpec.height * 0.12)
  const safeBottom = Math.round(gridSpec.height * 0.9)
  const marginX = 7
  const marginY = 7
  const left = clamp(minAnchorX - marginX, safeLeft, safeRight)
  const right = clamp(maxAnchorX + marginX, safeLeft, safeRight)
  const top = clamp(minAnchorY - marginY, safeTop, safeBottom)
  const bottom = clamp(maxAnchorY + marginY, safeTop, safeBottom)
  const radius = Math.max(4, Math.min(8, Math.round(Math.min(right - left, bottom - top) * 0.18)))

  carveRoundedRect(grid, left, top, right, bottom, radius)
  carvePlaza(grid, spawn, 5)

  for (const hotspot of world.hotspots) {
    const hotspotTile = pixelToTile(percentPoint(hotspot.x, hotspot.y))
    carvePlaza(grid, hotspotTile, hotspot.kind === 'npc' ? 5 : 4)
  }
  blockLandmarkIsland(grid, world)
  blockDecorationIslands(grid, world)
  carvePlaza(grid, spawn, 4)
  for (const hotspot of world.hotspots) {
    const hotspotTile = pixelToTile(percentPoint(hotspot.x, hotspot.y))
    carvePlaza(grid, hotspotTile, hotspot.kind === 'npc' ? 4 : 3)
    carveHotspotInteractionPocket(grid, spawn, hotspot)
  }

  return repairWalkableGrid(grid, {
    tileSize: stage.tileSize,
    preferredPoint: spawnPoint,
  })
}

async function writeNavigationTemplate(world: WorldConfig, grid: number[][], filePath: string) {
  const svg = buildNavigationTemplateSvg(world, grid)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  await sharp(Buffer.from(svg))
    .resize(stage.width, stage.height, { fit: 'fill' })
    .png()
    .toFile(filePath)
}

function buildNavigationTemplateSvg(world: WorldConfig, grid: number[][]) {
  const walkableRuns: string[] = []
  for (let y = 0; y < grid.length; y += 1) {
    let runStart: number | null = null
    for (let x = 0; x <= gridSpec.width; x += 1) {
      const isWalkable = x < gridSpec.width && grid[y]?.[x] === 0
      if (isWalkable && runStart === null) {
        runStart = x
      }
      if ((!isWalkable || x === gridSpec.width) && runStart !== null) {
        walkableRuns.push(
          `<rect x="${runStart * stage.tileSize}" y="${y * stage.tileSize}" width="${(x - runStart) * stage.tileSize}" height="${stage.tileSize}" fill="#d8c98c"/>`,
        )
        runStart = null
      }
    }
  }

  return [
    `<svg width="${stage.width}" height="${stage.height}" viewBox="0 0 ${stage.width} ${stage.height}" xmlns="http://www.w3.org/2000/svg">`,
    '<rect width="100%" height="100%" fill="#15131d"/>',
    `<rect x="${Math.round(stage.width * 0.08)}" y="${Math.round(stage.height * 0.1)}" width="${Math.round(stage.width * 0.84)}" height="${Math.round(stage.height * 0.82)}" rx="46" ry="46" fill="#211b29"/>`,
    ...walkableRuns,
    '<rect width="100%" height="100%" fill="none"/>',
    '</svg>',
  ].join('')
}

function fixedHotspotBounds(hotspot: WorldHotspot) {
  const center = percentPoint(hotspot.x, hotspot.y)
  const width = hotspot.kind === 'npc' ? 110 : 100
  const height = hotspot.kind === 'npc' ? 140 : 90
  return {
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height),
    width,
    height,
  }
}

function carveHotspotInteractionPocket(grid: number[][], spawn: { x: number; y: number }, hotspot: WorldHotspot) {
  const bounds = fixedHotspotBounds(hotspot)
  const bottomCenter = pixelToTile({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height + stage.tileSize,
  })
  carvePlaza(grid, bottomCenter, hotspot.kind === 'npc' ? 3 : 2)
  carveOrthogonalCorridor(grid, spawn, bottomCenter, 2)
}

function pixelToTile(point: { x: number; y: number }) {
  return {
    x: clamp(Math.floor(point.x / stage.tileSize), 0, gridSpec.width - 1),
    y: clamp(Math.floor(point.y / stage.tileSize), 0, gridSpec.height - 1),
  }
}

function carvePlaza(grid: number[][], center: { x: number; y: number }, radius: number) {
  carveRect(grid, center.x - radius, center.y - radius, center.x + radius, center.y + radius)
}

function blockLandmarkIsland(grid: number[][], world: WorldConfig) {
  blockPercentRect(grid, world.landmark.x, world.landmark.y, world.landmark.width, world.landmark.height, 4)
}

function blockDecorationIslands(grid: number[][], world: WorldConfig) {
  const blockingShapes = new Set<WorldLayerShape>(['panel', 'tower', 'arch', 'console', 'booth'])
  for (const decoration of world.decorations) {
    if (!blockingShapes.has(decoration.shape)) {
      continue
    }
    blockPercentRect(grid, decoration.x, decoration.y, decoration.width, decoration.height, 3)
  }
}

function blockPercentRect(grid: number[][], centerXPercent: number, centerYPercent: number, widthPercent: number, heightPercent: number, radius: number) {
  const center = percentPoint(centerXPercent, centerYPercent)
  const width = Math.round((widthPercent / 100) * stage.width)
  const height = Math.round((heightPercent / 100) * stage.height)
  blockPixelRect(grid, {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  }, radius)
}

function blockPixelRect(grid: number[][], rect: { x: number; y: number; width: number; height: number }, radius: number) {
  const left = Math.floor(rect.x / stage.tileSize)
  const top = Math.floor(rect.y / stage.tileSize)
  const right = Math.ceil((rect.x + rect.width) / stage.tileSize) - 1
  const bottom = Math.ceil((rect.y + rect.height) / stage.tileSize) - 1
  blockRoundedRect(grid, left, top, right, bottom, radius)
}

function carveRoundedRect(grid: number[][], left: number, top: number, right: number, bottom: number, radius: number) {
  const yStart = clamp(top, 0, gridSpec.height - 1)
  const yEnd = clamp(bottom, 0, gridSpec.height - 1)
  const xStart = clamp(left, 0, gridSpec.width - 1)
  const xEnd = clamp(right, 0, gridSpec.width - 1)
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const dx = Math.max(left - x, 0, x - right)
      const dy = Math.max(top - y, 0, y - bottom)
      const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x
      const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
      const roundedDx = x - cornerX
      const roundedDy = y - cornerY
      if ((dx === 0 && dy === 0) && roundedDx * roundedDx + roundedDy * roundedDy <= radius * radius) {
        grid[y][x] = 0
      }
    }
  }
}

function blockRoundedRect(grid: number[][], left: number, top: number, right: number, bottom: number, radius: number) {
  const yStart = clamp(top, 0, gridSpec.height - 1)
  const yEnd = clamp(bottom, 0, gridSpec.height - 1)
  const xStart = clamp(left, 0, gridSpec.width - 1)
  const xEnd = clamp(right, 0, gridSpec.width - 1)
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x
      const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
      const roundedDx = x - cornerX
      const roundedDy = y - cornerY
      if (roundedDx * roundedDx + roundedDy * roundedDy <= radius * radius) {
        grid[y][x] = 1
      }
    }
  }
}

function carveOrthogonalCorridor(
  grid: number[][],
  from: { x: number; y: number },
  to: { x: number; y: number },
  halfWidth: number,
) {
  carveRect(grid, from.x - halfWidth, Math.min(from.y, to.y), from.x + halfWidth, Math.max(from.y, to.y))
  carveRect(grid, Math.min(from.x, to.x), to.y - halfWidth, Math.max(from.x, to.x), to.y + halfWidth)
}

function carveRect(grid: number[][], left: number, top: number, right: number, bottom: number) {
  const yStart = clamp(top, 0, gridSpec.height - 1)
  const yEnd = clamp(bottom, 0, gridSpec.height - 1)
  const xStart = clamp(left, 0, gridSpec.width - 1)
  const xEnd = clamp(right, 0, gridSpec.width - 1)
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      grid[y][x] = 0
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function nextLayerId(tmj: TiledMapRecord) {
  const maxLayerId = Math.max(0, ...(tmj.layers ?? []).map((layer) => Number(layer.id ?? 0)))
  return maxLayerId + 1
}

function getNextObjectId(tmj: TiledMapRecord) {
  const objectIds = (tmj.layers ?? [])
    .flatMap((layer) => layer.objects ?? [])
    .map((object) => Number(object.id ?? 0))
  return Math.max(Number(tmj.nextobjectid ?? 1), ...objectIds, 0) + 1
}

function findNearestWalkableSpawn(walkableGrid: { grid?: number[][]; tileSize?: number }, fallbackPercentSpawn: { x: number; y: number }) {
  const fallback = percentPoint(fallbackPercentSpawn.x, fallbackPercentSpawn.y)
  const grid = walkableGrid.grid
  const tileSize = walkableGrid.tileSize ?? stage.tileSize
  if (!grid?.length) {
    return fallback
  }
  const startX = Math.max(0, Math.min(grid[0].length - 1, Math.floor(fallback.x / tileSize)))
  const startY = Math.max(0, Math.min(grid.length - 1, Math.floor(fallback.y / tileSize)))
  const queue = [{ x: startX, y: startY }]
  const visited = new Set<string>([`${startX},${startY}`])
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (grid[current.y]?.[current.x] === 0) {
      return {
        x: current.x * tileSize + tileSize / 2,
        y: current.y * tileSize + tileSize / 2,
      }
    }
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      const key = `${next.x},${next.y}`
      if (next.x < 0 || next.y < 0 || next.y >= grid.length || next.x >= grid[0].length || visited.has(key)) {
        continue
      }
      visited.add(key)
      queue.push(next)
    }
  }
  return fallback
}

function readInteractiveBounds(tmj: { layers?: Array<{ name?: string; objects?: Array<Record<string, unknown>> }> }) {
  const layer = tmj.layers?.find((item) => item.name === 'interactive_objects')
  const bounds: Record<string, { x: number; y: number; width: number; height: number }> = {}
  for (const object of layer?.objects ?? []) {
    const properties = Array.isArray(object.properties) ? object.properties : []
    const idProperty = properties.find((property) => typeof property === 'object' && property !== null && 'name' in property && property.name === 'objectId') as { value?: string } | undefined
    if (!idProperty?.value) {
      continue
    }
    bounds[idProperty.value] = {
      x: Number(object.x ?? 0),
      y: Number(object.y ?? 0),
      width: Number(object.width ?? 0),
      height: Number(object.height ?? 0),
    }
  }
  return bounds
}

function parseArgs(args: string[]): CliOptions {
  const all = args.includes('--all')
  const dryRun = args.includes('--dry-run')
  const publish = args.includes('--publish')
  const force = args.includes('--force')
  const skipPlayer = args.includes('--skip-player')
  const proceduralPlayer = args.includes('--procedural-player')
  const archetypeIndex = args.indexOf('--archetype')
  const archetype = archetypeIndex >= 0 ? args[archetypeIndex + 1] as ArchetypeId : undefined
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined
  const sourceCharacterDirIndex = args.indexOf('--source-character-dir')
  const sourceCharacterDir = sourceCharacterDirIndex >= 0 ? args[sourceCharacterDirIndex + 1] : undefined
  if (!all && !archetype) {
    throw new Error('Use --all or --archetype <BEDX|GONE|...>.')
  }
  if (archetype && !archetypePriority.includes(archetype)) {
    throw new Error(`Unknown archetype: ${archetype}`)
  }
  if (only && !['map', 'player'].includes(only) && !only.startsWith('hotspot:')) {
    throw new Error('Use --only map, --only player, or --only hotspot:<id>.')
  }
  if (sourceCharacterDir && only !== 'player') {
    throw new Error('--source-character-dir can only be used with --only player.')
  }
  if (skipPlayer && only === 'player') {
    throw new Error('--skip-player cannot be combined with --only player.')
  }
  if (skipPlayer && proceduralPlayer) {
    throw new Error('--skip-player cannot be combined with --procedural-player.')
  }
  return { all, archetype, dryRun, publish, only, force, skipPlayer, proceduralPlayer, sourceCharacterDir }
}

function shouldRunAsset(assetId: string) {
  if (options.skipPlayer && assetId === 'player') {
    return false
  }
  return !options.only || options.only === assetId
}

function shouldForceAsset(assetId: string) {
  return options.force && shouldRunAsset(assetId)
}

function runCommand(command: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
}

function getLatestMapRunDir(mapOutputDir: string) {
  const runsFile = path.join(mapOutputDir, 'runs.json')
  if (fs.existsSync(runsFile)) {
    const runs = JSON.parse(fs.readFileSync(runsFile, 'utf-8')) as string[]
    const latest = runs.at(-1)
    if (latest) {
      return path.join(mapOutputDir, latest)
    }
  }
  return getLatestChildDir(mapOutputDir)
}

function getLatestChildDir(parentDir: string) {
  const dirs = fs.readdirSync(parentDir)
    .map((name) => path.join(parentDir, name))
    .filter((item) => fs.statSync(item).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (!dirs[0]) {
    throw new Error(`No output directory found under ${parentDir}`)
  }
  return dirs[0]
}

function pathToPublicAsset(filePath: string) {
  return path.relative(path.join(repoRoot, 'client/public'), filePath).split(path.sep).join('/')
}

function copyRequired(source: string, destination: string) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing generated file: ${source}`)
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

function writeText(filePath: string, data: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${data.trim()}\n`)
}
