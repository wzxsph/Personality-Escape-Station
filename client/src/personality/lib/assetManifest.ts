import type { ArchetypeId } from '../data/types'
import type {
  GeneratedSpriteAsset,
  PersonalityAssetManifest,
} from '../data/assetManifest'
import type { WorldConfig, WorldSpriteAsset } from '../data/worlds'

const assetBaseUrl = import.meta.env.BASE_URL

export const fixedAssetManifestPath = (archetypeId: ArchetypeId) =>
  `personality-assets/fixed/${archetypeId.toLowerCase()}/manifest.json`

export async function loadPersonalityAssetManifest(archetypeId: ArchetypeId) {
  const path = fixedAssetManifestPath(archetypeId)
  const response = await fetch(resolveAssetUrl(path), { cache: 'no-cache' })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) {
    return null
  }

  const manifest = (await response.json()) as PersonalityAssetManifest
  return manifest.archetypeId === archetypeId ? manifest : null
}

export function applyPersonalityAssetManifest(
  world: WorldConfig,
  manifest: PersonalityAssetManifest | null | undefined,
): WorldConfig {
  if (!manifest) {
    return world
  }

  const hotspotSprites = manifest.hotspots.reduce<Partial<Record<string, WorldSpriteAsset>>>(
    (accumulator, hotspot) => {
      if (hotspot.sprite) {
        accumulator[hotspot.id] = toWorldSpriteAsset(hotspot.sprite)
      }
      return accumulator
    },
    {},
  )

  const generatedAssets = {
    backgroundImage: manifest.map.backgroundImage,
    mapTmj: manifest.map.tmjPath,
    walkableGrid: manifest.map.walkableGridPath,
    playerSprite: manifest.player?.sprite ? toWorldSpriteAsset(manifest.player.sprite) : world.assets?.playerSprite,
    hotspotSprites: {
      ...world.assets?.hotspotSprites,
      ...hotspotSprites,
    },
  }

  return {
    ...world,
    generatedAssets: manifest,
    assets: {
      ...world.assets,
      ...generatedAssets,
    },
  }
}

function toWorldSpriteAsset(asset: GeneratedSpriteAsset): WorldSpriteAsset {
  return {
    sourceType: asset.sourceType,
    imagePath: asset.imagePath,
    framesDir: asset.framesDir,
    frameCount: asset.frameCount,
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    columns: asset.columns,
    rows: asset.rows,
    frameIndex: asset.frameIndex,
    scale: asset.scale,
    layout: asset.layout,
    qualityStatus: asset.qualityStatus,
    animations: asset.animations,
  }
}

function resolveAssetUrl(assetPath: string) {
  const normalizedAssetPath = assetPath.replace(/^\/+/, '')
  return `${assetBaseUrl}${normalizedAssetPath}`
}
