import {
  hiddenArchetypeId,
  regularArchetypeIds,
  type ArchetypeId,
  type QuizAnswer,
  type RegularArchetypeId,
} from '../data/types'
import { getVariantFallbackVisitWorldId, resolveVariantWorldId } from '../config/appVariant'

export const isRegularArchetypeId = (value: string | null | undefined): value is RegularArchetypeId =>
  Boolean(value) && regularArchetypeIds.includes(value as RegularArchetypeId)

export const isArchetypeId = (value: string | null | undefined): value is ArchetypeId =>
  value === hiddenArchetypeId || isRegularArchetypeId(value)

export const resolvePlayableWorldId = (winner: ArchetypeId, _answers: QuizAnswer[]): ArchetypeId =>
  resolveVariantWorldId(isRegularArchetypeId(winner) ? winner : hiddenArchetypeId)

export const getFallbackVisitWorldId = (myWorldId: ArchetypeId): ArchetypeId => {
  const fallbackWorldId = getVariantFallbackVisitWorldId(myWorldId)
  return isRegularArchetypeId(fallbackWorldId)
    ? fallbackWorldId
    : regularArchetypeIds.find((id) => id !== myWorldId) ?? hiddenArchetypeId
}
