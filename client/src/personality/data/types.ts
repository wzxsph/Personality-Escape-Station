export const regularArchetypeIds = [
  'BEDX',
  'GONE',
  'SIDE',
  'SPRK',
  'F1SH',
  'NOCT',
  'UNDO',
  'MUT8',
  'BUFR',
  'JANK',
  'FINE',
] as const

export const hiddenArchetypeId = 'GL1T' as const
export const archetypePriority = [...regularArchetypeIds, hiddenArchetypeId] as const

export type RegularArchetypeId = (typeof regularArchetypeIds)[number]
export type HiddenArchetypeId = typeof hiddenArchetypeId
export type ArchetypeId = RegularArchetypeId | HiddenArchetypeId
export type OptionId = 'A' | 'B' | 'C' | 'D'

export type DimensionSide = '收' | '放' | '撤' | '扛' | '缓' | '爆' | '正' | '偏'
export type DimensionPairKey = 'shouFang' | 'cheKang' | 'huanBao' | 'zhengPian'

export const personaMaxScores: Record<RegularArchetypeId, number> = {
  BEDX: 4,
  GONE: 4,
  SIDE: 4,
  SPRK: 4,
  F1SH: 4,
  NOCT: 3,
  UNDO: 4,
  MUT8: 3,
  BUFR: 3,
  JANK: 3,
  FINE: 4,
}

export const personaDimensions: Record<RegularArchetypeId, readonly DimensionSide[]> = {
  BEDX: ['收', '撤', '缓', '正'],
  GONE: ['收', '撤', '缓', '偏'],
  SIDE: ['收', '撤', '缓', '偏'],
  SPRK: ['放', '扛', '爆', '偏'],
  F1SH: ['收', '撤', '缓', '偏'],
  NOCT: ['收', '扛', '缓', '偏'],
  UNDO: ['收', '扛', '缓', '正'],
  MUT8: ['放', '扛', '爆', '偏'],
  BUFR: ['收', '扛', '缓', '正'],
  JANK: ['放', '扛', '爆', '偏'],
  FINE: ['收', '扛', '缓', '正'],
}

export interface QuizOption {
  id: OptionId
  text: string
  scores: RegularArchetypeId[]
}

export interface QuizQuestion {
  id: string
  kicker: string
  title: string
  options: QuizOption[]
}

export interface QuizAnswer {
  questionId: string
  optionId: OptionId
}

export type SceneVisualTheme =
  | 'blanket'
  | 'offline'
  | 'sideQuest'
  | 'spark'
  | 'drift'
  | 'night'
  | 'timeline'
  | 'overload'
  | 'buffer'
  | 'inspector'
  | 'polished'
  | 'glitch'

export type SceneMotionPreset = 'float' | 'soft' | 'pulse' | 'drift' | 'night' | 'glitch'

export interface SceneVisual {
  theme: SceneVisualTheme
  motion: SceneMotionPreset
}

export interface PersonalityScene {
  title: string
  paletteName: string
  colors: {
    primary: string
    secondary: string
    accent: string
    soft: string
  }
  dressCode: string
  bgm: string
  signature: string
  objects: string[]
  gifts: string[]
  visual: SceneVisual
}

export interface ArchetypeResult {
  id: ArchetypeId
  name: string
  englishName: string
  label: string
  trait: string
  tagline: string
  story: {
    roast: string
    resonance: string
    gentle: string
  }
  scene: PersonalityScene
  shareLine: string
}

/** 广播消息 */
export interface BroadcastMessage {
  id: string
  text: string
  priority?: number
}

/** 对话回复节点 */
export interface DialogueResponse {
  id: string
  keywords: string[]
  response: string
  isTaskComplete?: boolean
}

/** Hotspot 对话任务配置 */
export interface HotspotDialogueTask {
  greeting: string
  hintPlaceholder: string
  responses: DialogueResponse[]
  fallbackResponse: string
  maxRounds: number
  taskDescription: string
}

/** 人格碎片 */
export interface PersonaFragment {
  id: string
  hotspotId: string
  title: string
  content: string
  order: number
}