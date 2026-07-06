import type { ArchetypeId } from './types'

export interface PersonalityStageSpec {
  width: number
  height: number
  tileSize: number
}

export interface GeneratedSpriteAnimationSet {
  walkLeft?: { start: number; end: number; frameRate?: number }
  walkRight?: { start: number; end: number; frameRate?: number }
  walkDown?: { start: number; end: number; frameRate?: number }
  walkDownLeft?: { start: number; end: number; frameRate?: number }
  walkDownRight?: { start: number; end: number; frameRate?: number }
  walkUp?: { start: number; end: number; frameRate?: number }
  walkUpLeft?: { start: number; end: number; frameRate?: number }
  walkUpRight?: { start: number; end: number; frameRate?: number }
  idleDown?: number
  idleDownLeft?: number
  idleDownRight?: number
  idleFront?: number
  idleRight?: number
  idleUp?: number
  idleUpLeft?: number
  idleUpRight?: number
  idleBack?: number
  idleLeft?: number
}

export interface GeneratedAssetQualityStatus {
  status: 'passed' | 'failed'
  issues: string[]
  checkedAt: string
}

export interface GeneratedSpriteAsset {
  sourceType: 'spritesheet' | 'frames' | 'image'
  imagePath?: string
  framesDir?: string
  frameCount?: number
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  frameIndex: number
  scale: number
  layout?: 'player-8dir-8x8-v1' | 'single-image-v1' | 'legacy'
  qualityStatus?: GeneratedAssetQualityStatus
  animations?: GeneratedSpriteAnimationSet
}

export interface GeneratedRoomAsset {
  backgroundImage: string
  tmjPath: string
  walkableGridPath: string
  navigationTemplatePath?: string
  roomLayoutPath?: string
  stylePackPath?: string
  generationMode?: 'composite-v1' | 'whole-image-v1'
}

export interface GeneratedInteractionBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GeneratedHotspotAsset {
  id: string
  kind: 'object' | 'npc'
  label: string
  sprite?: GeneratedSpriteAsset
  systemPromptPath?: string
  interactionBounds?: GeneratedInteractionBounds
}

export interface PersonalityAssetManifest {
  version: 1
  archetypeId: ArchetypeId
  stage: PersonalityStageSpec
  spawn: { x: number; y: number }
  map: GeneratedRoomAsset
  player?: {
    sprite?: GeneratedSpriteAsset
    promptPath?: string
  }
  hotspots: GeneratedHotspotAsset[]
  agents: Record<string, GeneratedHotspotAsset>
  props: Record<string, GeneratedHotspotAsset>
  safeArea: {
    x: number
    y: number
    width: number
    height: number
  }
  provenance: {
    pipeline: string
    runId: string
    dryRun?: boolean
    generatedAt: string
  }
}
