import type { ArchetypeId, RegularArchetypeId } from '../data/types'

export const offlineLiteWorldIds = ['BEDX', 'SPRK'] as const satisfies readonly RegularArchetypeId[]

export const offlineLiteWorldMapping = {
  BEDX: 'BEDX',
  GONE: 'BEDX',
  SIDE: 'BEDX',
  SPRK: 'SPRK',
  F1SH: 'BEDX',
  NOCT: 'BEDX',
  UNDO: 'BEDX',
  MUT8: 'SPRK',
  BUFR: 'BEDX',
  JANK: 'SPRK',
  FINE: 'BEDX',
  GL1T: 'SPRK',
} as const satisfies Record<ArchetypeId, RegularArchetypeId>
