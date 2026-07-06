import fs from 'node:fs'
import path from 'node:path'
import { archetypePriority } from '../src/personality/data/types'
import { worldConfigs } from '../src/personality/data/worlds'
import {
  getObjectInteractionAnchor,
  repairWalkableGrid,
} from '../src/personality/worldx-native/walkableGridRepair'
import type { PersonalityAssetManifest } from '../src/personality/data/assetManifest'

const publicRoot = path.resolve('public')
const assetRoot = path.join(publicRoot, 'personality-assets/fixed')
const strictManifest = process.argv.includes('--strict-manifest')
const archetypeArgIndex = process.argv.indexOf('--archetype')
const requestedArchetype = archetypeArgIndex >= 0 ? process.argv[archetypeArgIndex + 1] : undefined
const targetArchetypes = requestedArchetype
  ? archetypePriority.filter((archetypeId) => archetypeId === requestedArchetype)
  : archetypePriority
const issues: string[] = []
const warnings: string[] = []

if (requestedArchetype && targetArchetypes.length === 0) {
  issues.push(`unknown archetype ${requestedArchetype}`)
}

for (const archetypeId of targetArchetypes) {
  const lowerId = archetypeId.toLowerCase()
  const manifestPath = path.join(assetRoot, lowerId, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    verifyManifest(manifestPath)
    continue
  }

  if (strictManifest) {
    issues.push(`missing ${lowerId}/manifest.json`)
    continue
  }

  verifyLegacyFallback(archetypeId)
}

if (issues.length > 0) {
  console.error(JSON.stringify(issues, null, 2))
  process.exit(1)
}

if (warnings.length > 0) {
  console.warn(JSON.stringify(warnings, null, 2))
}

console.log('Fixed personality asset library verification passed.')

function verifyManifest(manifestPath: string) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PersonalityAssetManifest
  const archetypeId = manifest.archetypeId
  const world = worldConfigs[archetypeId]
  const label = archetypeId.toLowerCase()

  if (manifest.version !== 1) {
    issues.push(`${label}: manifest.version must be 1`)
  }
  if (manifest.stage.width !== 900 || manifest.stage.height !== 1600) {
    issues.push(`${label}: stage must be 900x1600`)
  }
  if (!world) {
    issues.push(`${label}: unknown archetypeId`)
    return
  }
  existsAsset(`personality-assets/fixed/${label}/room-design.json`)
  existsAsset(`personality-assets/fixed/${label}/system-prompt.md`)

  const expectedHotspotIds = new Set(world.hotspots.map((hotspot) => hotspot.id))
  const manifestHotspotIds = new Set(manifest.hotspots.map((hotspot) => hotspot.id))
  for (const hotspotId of expectedHotspotIds) {
    if (!manifestHotspotIds.has(hotspotId)) {
      issues.push(`${label}: missing hotspot asset ${hotspotId}`)
    }
  }
  for (const hotspotId of manifestHotspotIds) {
    if (!expectedHotspotIds.has(hotspotId)) {
      issues.push(`${label}: unknown hotspot asset ${hotspotId}`)
    }
  }

  const backgroundPath = resolvePublicAsset(manifest.map.backgroundImage)
  if (existsAsset(manifest.map.backgroundImage)) {
    const pngSize = readPngSize(backgroundPath)
    if (!pngSize || pngSize.width !== 900 || pngSize.height !== 1600) {
      issues.push(`${label}: map/background.png must be 900x1600 PNG`)
    }
  }
  if (manifest.map.navigationTemplatePath) {
    const templatePath = resolvePublicAsset(manifest.map.navigationTemplatePath)
    if (existsAsset(manifest.map.navigationTemplatePath)) {
      const pngSize = readPngSize(templatePath)
      if (!pngSize || pngSize.width !== 900 || pngSize.height !== 1600) {
        issues.push(`${label}: map/navigation-template.png must be 900x1600 PNG`)
      }
    }
  }
  if (manifest.map.roomLayoutPath) {
    const layout = readJsonAsset(manifest.map.roomLayoutPath, `${label}: missing room-layout.json`) as { version?: string; masks?: { walkableGrid?: number[][] } } | null
    if (layout?.version !== 'room-layout-template-v1') {
      issues.push(`${label}: map/room-layout.json must use room-layout-template-v1`)
    }
    if (layout?.masks?.walkableGrid && (layout.masks.walkableGrid.length !== 80 || layout.masks.walkableGrid.some((row) => row.length !== 45))) {
      issues.push(`${label}: room-layout walkableGrid must be 45x80`)
    }
  }
  if (manifest.map.stylePackPath) {
    const stylePack = readJsonAsset(manifest.map.stylePackPath, `${label}: missing style-pack.json`) as { version?: string; palette?: Record<string, string> } | null
    if (stylePack?.version !== 'style-pack-composite-v1') {
      issues.push(`${label}: map/style-pack.json must use style-pack-composite-v1`)
    }
    if (!stylePack?.palette?.floor || !stylePack.palette.blocked || !stylePack.palette.trim) {
      issues.push(`${label}: style-pack palette is incomplete`)
    }
  }
  if (manifest.map.generationMode && !['composite-v1', 'whole-image-v1'].includes(manifest.map.generationMode)) {
    issues.push(`${label}: unsupported map generationMode ${manifest.map.generationMode}`)
  }

  const tmj = readJsonAsset(manifest.map.tmjPath, `${label}: missing map.tmj`) as TiledMap | null
  const walkable = readJsonAsset(manifest.map.walkableGridPath, `${label}: missing walkable-grid.json`) as WalkableGrid | null
  if (tmj) {
    verifyTmj(label, tmj, manifest)
  }
  if (tmj && walkable) {
    verifyDeterministicWalkableSource(label, walkable)
    verifyCollisionMatchesWalkable(label, tmj, walkable)
    verifyWalkableIsRepaired(label, tmj, walkable, manifest)
    verifyWalkableTopology(label, walkable)
    verifyFixedHotspotAnchors(label, tmj, manifest)
    verifyConnectivity(label, tmj, walkable, manifest)
  }

  if (!manifest.player?.sprite) {
    issues.push(`${label}: missing player sprite asset`)
  } else {
    verifySprite(`${label}: player`, manifest.player.sprite)
  }
  if (manifest.player?.promptPath) {
    existsAsset(manifest.player.promptPath)
  }
  for (const hotspot of manifest.hotspots) {
    if (hotspot.sprite) {
      verifySprite(`${label}: ${hotspot.id}`, hotspot.sprite)
    }
    if (hotspot.kind === 'npc' && hotspot.systemPromptPath) {
      existsAsset(hotspot.systemPromptPath)
    }
  }
}

function verifyTmj(label: string, tmj: TiledMap, manifest: PersonalityAssetManifest) {
  const expectedWidth = tmj.width * tmj.tilewidth
  const expectedHeight = tmj.height * tmj.tileheight
  if (expectedWidth !== manifest.stage.width || expectedHeight !== manifest.stage.height) {
    issues.push(`${label}: TMJ pixel size must match ${manifest.stage.width}x${manifest.stage.height}`)
  }

  const collision = tmj.layers.find((layer) => layer.type === 'tilelayer' && layer.name === 'collision')
  if (!collision?.data || collision.data.length !== tmj.width * tmj.height) {
    issues.push(`${label}: collision layer size is invalid`)
  }

  const interactive = tmj.layers.find((layer) => layer.type === 'objectgroup' && layer.name === 'interactive_objects')
  const objectIds = new Set((interactive?.objects ?? []).map((object) => readObjectProperty(object, 'objectId')).filter(Boolean))
  for (const hotspot of manifest.hotspots) {
    if (!objectIds.has(hotspot.id)) {
      issues.push(`${label}: TMJ missing interactive object ${hotspot.id}`)
    }
  }
}

function verifyDeterministicWalkableSource(label: string, walkable: WalkableGrid) {
  if (walkable.source?.mode !== 'fixed-personality-deterministic-v1') {
    issues.push(`${label}: walkable-grid source.mode must be fixed-personality-deterministic-v1`)
  }
  if (walkable.source?.templatePath) {
    existsAsset(walkable.source.templatePath)
  }
}

function verifyConnectivity(label: string, tmj: TiledMap, walkable: WalkableGrid, manifest: PersonalityAssetManifest) {
  const grid = walkable.grid
  const tileSize = walkable.tileSize ?? tmj.tilewidth
  if (!Array.isArray(grid) || grid.length !== tmj.height || grid.some((row) => row.length !== tmj.width)) {
    issues.push(`${label}: walkable grid dimensions must match TMJ`)
    return
  }

  const start = nearestWalkable(grid, tileSize, manifest.spawn)
  if (!start) {
    issues.push(`${label}: spawn is not near any walkable tile`)
    return
  }

  const reachable = floodFill(grid, start)
  const interactive = tmj.layers.find((layer) => layer.type === 'objectgroup' && layer.name === 'interactive_objects')
  for (const object of interactive?.objects ?? []) {
    const objectId = readObjectProperty(object, 'objectId')
    if (!objectId) {
      continue
    }
    const targetPoint = getObjectInteractionAnchor(object, grid, tileSize)
    if (!targetPoint) {
      issues.push(`${label}: hotspot ${objectId} does not have a walkable interaction anchor`)
      continue
    }
    const target = pixelToGrid(targetPoint, tileSize)
    if (grid[target.y]?.[target.x] !== 0) {
      issues.push(`${label}: hotspot ${objectId} interaction anchor is blocked`)
      continue
    }
    if (!reachable.has(`${target.x},${target.y}`)) {
      issues.push(`${label}: hotspot ${objectId} is not reachable from spawn`)
    }
  }
}

function verifyWalkableTopology(label: string, walkable: WalkableGrid) {
  const grid = walkable.grid
  const total = grid.reduce((sum, row) => sum + row.length, 0)
  const components = findGridComponents(grid, 0)
  const walkableCount = components.reduce((sum, component) => sum + component.size, 0)
  const ratio = total > 0 ? walkableCount / total : 0

  if (components.length !== 1) {
    issues.push(`${label}: walkable grid must have exactly one main component, got ${components.length}`)
  }
  if (ratio < 0.08 || ratio > 0.65) {
    issues.push(`${label}: walkable ratio ${(ratio * 100).toFixed(1)}% is outside expected deterministic range`)
  }
}

function verifyFixedHotspotAnchors(label: string, tmj: TiledMap, manifest: PersonalityAssetManifest) {
  const world = worldConfigs[manifest.archetypeId]
  const interactive = tmj.layers.find((layer) => layer.type === 'objectgroup' && layer.name === 'interactive_objects')
  const objects = interactive?.objects ?? []
  for (const hotspot of world.hotspots) {
    const object = objects.find((item) => readObjectProperty(item, 'objectId') === hotspot.id)
    if (!object) {
      issues.push(`${label}: missing fixed hotspot object ${hotspot.id}`)
      continue
    }

    const expectedAnchor = {
      x: Math.round((hotspot.x / 100) * manifest.stage.width),
      y: Math.round((hotspot.y / 100) * manifest.stage.height),
    }
    const actualAnchor = {
      x: object.x + object.width / 2,
      y: object.y + object.height,
    }
    const distance = Math.hypot(actualAnchor.x - expectedAnchor.x, actualAnchor.y - expectedAnchor.y)
    if (distance > manifest.stage.tileSize) {
      issues.push(`${label}: hotspot ${hotspot.id} bbox bottom-center is ${distance.toFixed(1)}px from designed anchor`)
    }

    if (readObjectProperty(object, 'source') !== 'fixed-personality-coordinate-v1') {
      issues.push(`${label}: hotspot ${hotspot.id} source must be fixed-personality-coordinate-v1`)
    }
    if (readObjectProperty(object, 'kind') !== hotspot.kind) {
      issues.push(`${label}: hotspot ${hotspot.id} kind property must be ${hotspot.kind}`)
    }

    const manifestHotspot = manifest.hotspots.find((item) => item.id === hotspot.id)
    const bounds = manifestHotspot?.interactionBounds
    if (!bounds || bounds.x !== object.x || bounds.y !== object.y || bounds.width !== object.width || bounds.height !== object.height) {
      issues.push(`${label}: hotspot ${hotspot.id} manifest interactionBounds must match TMJ object`)
    }
  }
}

function verifyCollisionMatchesWalkable(label: string, tmj: TiledMap, walkable: WalkableGrid) {
  const collision = tmj.layers.find((layer) => layer.type === 'tilelayer' && layer.name === 'collision')
  if (!collision?.data) {
    return
  }
  const grid = walkable.grid
  for (let y = 0; y < tmj.height; y += 1) {
    for (let x = 0; x < tmj.width; x += 1) {
      const collisionValue = collision.data[y * tmj.width + x] === 0 ? 0 : 1
      const walkableValue = grid[y]?.[x] === 0 ? 0 : 1
      if (collisionValue !== walkableValue) {
        issues.push(`${label}: TMJ collision layer differs from walkable-grid at ${x},${y}`)
        return
      }
    }
  }
}

function findGridComponents(grid: number[][], value: number) {
  const height = grid.length
  const width = grid[0]?.length ?? 0
  const visited = Array.from({ length: height }, () => Array.from({ length: width }, () => false))
  const components: Array<{ size: number }> = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (visited[y][x] || grid[y][x] !== value) {
        continue
      }
      const queue = [{ x, y }]
      visited[y][x] = true
      let size = 0
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]
        size += 1
        for (const next of [
          { x: current.x + 1, y: current.y },
          { x: current.x - 1, y: current.y },
          { x: current.x, y: current.y + 1 },
          { x: current.x, y: current.y - 1 },
        ]) {
          if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
            continue
          }
          if (visited[next.y][next.x] || grid[next.y][next.x] !== value) {
            continue
          }
          visited[next.y][next.x] = true
          queue.push(next)
        }
      }
      components.push({ size })
    }
  }
  return components
}

function verifyWalkableIsRepaired(label: string, tmj: TiledMap, walkable: WalkableGrid, manifest: PersonalityAssetManifest) {
  const repaired = repairWalkableGrid(walkable.grid, {
    tileSize: walkable.tileSize ?? tmj.tilewidth,
    preferredPoint: manifest.spawn,
  })
  for (let y = 0; y < repaired.length; y += 1) {
    for (let x = 0; x < (repaired[y]?.length ?? 0); x += 1) {
      if (repaired[y][x] !== walkable.grid[y]?.[x]) {
        issues.push(`${label}: walkable grid still contains repairable gap/noise at ${x},${y}`)
        return
      }
    }
  }
}

function verifySprite(label: string, sprite: PersonalityAssetManifest['hotspots'][number]['sprite']) {
  if (!sprite) {
    return
  }
  if (sprite.qualityStatus?.status === 'failed') {
    issues.push(`${label}: sprite quality failed: ${sprite.qualityStatus.issues.join('; ')}`)
  }

  if (sprite.sourceType === 'frames') {
    if (!sprite.framesDir) {
      issues.push(`${label}: frames sprite missing framesDir`)
      return
    }
    existsAsset(`${sprite.framesDir}/frame_000.png`)
    existsAsset(`${sprite.framesDir}/metadata.json`)
    if ((sprite.frameCount ?? 0) > 1) {
      existsAsset(`${sprite.framesDir}/frame_${String((sprite.frameCount ?? 1) - 1).padStart(3, '0')}.png`)
    }
    if (sprite.layout === 'player-8dir-8x8-v1') {
      if (sprite.columns !== 8 || sprite.rows !== 8 || sprite.frameWidth !== 256 || sprite.frameHeight !== 256 || sprite.frameCount !== 64) {
        issues.push(`${label}: player-8dir-8x8-v1 must be 8x8 with 64 256x256 frames`)
      }
      if (!sprite.animations?.walkDownLeft || !sprite.animations.walkUpLeft || !sprite.animations.walkUpRight || !sprite.animations.walkDownRight) {
        issues.push(`${label}: player-8dir-8x8-v1 missing diagonal walk animations`)
      }
    }
    return
  }

  if (sprite.sourceType === 'image') {
    if (!sprite.imagePath) {
      issues.push(`${label}: image sprite missing imagePath`)
      return
    }
    existsAsset(sprite.imagePath)
    existsAsset(`${path.posix.dirname(sprite.imagePath)}/metadata.json`)
    if (sprite.columns !== 1 || sprite.rows !== 1 || sprite.frameCount !== 1) {
      issues.push(`${label}: image sprite must have a 1x1 frame model`)
    }
    return
  }

  if (!sprite.imagePath) {
    issues.push(`${label}: spritesheet missing imagePath`)
    return
  }
  existsAsset(sprite.imagePath)
}

function verifyLegacyFallback(archetypeId: string) {
  const lowerId = archetypeId.toLowerCase()
  warnings.push(`${lowerId}: using programmatic fallback; publish a manifest to enable generated asset verification`)
}

function existsAsset(assetPath: string) {
  const absolutePath = resolvePublicAsset(assetPath)
  const ok = fs.existsSync(absolutePath)
  if (!ok) {
    issues.push(`missing ${assetPath}`)
  }
  return ok
}

function readJsonAsset(assetPath: string, missingMessage: string) {
  const absolutePath = resolvePublicAsset(assetPath)
  if (!fs.existsSync(absolutePath)) {
    issues.push(missingMessage)
    return null
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf-8')) as unknown
}

function resolvePublicAsset(assetPath: string) {
  const normalized = assetPath.replace(/^\/+/, '')
  const absolutePath = path.resolve(publicRoot, normalized)
  if (!absolutePath.startsWith(publicRoot)) {
    throw new Error(`Asset path escapes public root: ${assetPath}`)
  }
  return absolutePath
}

function readPngSize(filePath: string) {
  const buffer = fs.readFileSync(filePath)
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    return null
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function readObjectProperty(object: TiledObject, name: string) {
  return object.properties?.find((property) => property.name === name)?.value
}

function nearestWalkable(grid: number[][], tileSize: number, point: { x: number; y: number }) {
  const { x: startX, y: startY } = pixelToGrid(point, tileSize)
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let y = startY - radius; y <= startY + radius; y += 1) {
      for (let x = startX - radius; x <= startX + radius; x += 1) {
        if (grid[y]?.[x] === 0) {
          return { x, y }
        }
      }
    }
  }
  return null
}

function pixelToGrid(point: { x: number; y: number }, tileSize: number) {
  return {
    x: Math.floor(point.x / tileSize),
    y: Math.floor(point.y / tileSize),
  }
}

function floodFill(grid: number[][], start: { x: number; y: number }) {
  const queue = [start]
  const visited = new Set<string>([`${start.x},${start.y}`])
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]) {
      const key = `${next.x},${next.y}`
      if (grid[next.y]?.[next.x] !== 0 || visited.has(key)) {
        continue
      }
      visited.add(key)
      queue.push(next)
    }
  }
  return visited
}

interface WalkableGrid {
  gridWidth: number
  gridHeight: number
  tileSize?: number
  grid: number[][]
  source?: {
    mode?: string
    templatePath?: string
  }
}

interface TiledMap {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: TiledLayer[]
}

interface TiledLayer {
  type: 'tilelayer' | 'objectgroup' | 'imagelayer'
  name: string
  data?: number[]
  objects?: TiledObject[]
}

interface TiledObject {
  name?: string
  x: number
  y: number
  width: number
  height: number
  properties?: Array<{ name: string; value: string | number }>
}
