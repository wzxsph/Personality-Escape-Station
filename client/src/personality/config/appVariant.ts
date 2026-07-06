import { regularArchetypeIds, type ArchetypeId, type RegularArchetypeId } from '../data/types'
import { defaultOnlineFullAppUrl } from './publicUrl'
import { offlineLiteWorldIds, offlineLiteWorldMapping } from './variantShared'

export { offlineLiteWorldIds } from './variantShared'

export const appVariant = import.meta.env.VITE_APP_VARIANT === 'offline-lite' ? 'offline-lite' : 'online-full'
export const isOfflineLite = appVariant === 'offline-lite'
export const onlineFullAppUrl = defaultOnlineFullAppUrl

export const resolveVariantWorldId = (winner: ArchetypeId): ArchetypeId =>
  isOfflineLite ? offlineLiteWorldMapping[winner] : winner

export const getVariantFallbackVisitWorldId = (myWorldId: ArchetypeId): ArchetypeId => {
  const candidates = isOfflineLite ? offlineLiteWorldIds : regularArchetypeIds
  return candidates.find((id) => id !== myWorldId) ?? offlineLiteWorldIds[0]
}

export const getOfflineLiteWorldLabel = (worldId: RegularArchetypeId) => {
  if (worldId === 'BEDX') {
    return '被窝领事馆'
  }

  return '火花排练场'
}
