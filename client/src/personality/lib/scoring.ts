import { questions } from '../data/questions'
import {
  archetypePriority,
  hiddenArchetypeId,
  personaDimensions,
  personaMaxScores,
  regularArchetypeIds,
  type ArchetypeId,
  type DimensionSide,
  type QuizAnswer,
  type RegularArchetypeId,
} from '../data/types'

export type ScoreBoard = Record<ArchetypeId, number>

export interface PersonaMatch {
  code: ArchetypeId
  rawScore: number
  matchRate: number
}

export interface DimensionRates {
  shou: number
  fang: number
  che: number
  kang: number
  huan: number
  bao: number
  zheng: number
  pian: number
}

export interface ScoreResult {
  winner: ArchetypeId
  scores: ScoreBoard
  answeredCount: number
  hiddenTriggered: boolean
  hiddenHitCount: number
  primaryRawScore: number
  primaryMatchRate: number
  topPersonas: PersonaMatch[]
  dimensionRates: DimensionRates
}

const hiddenMarkerAnswers = new Set(['q2:C', 'q3:A', 'q6:B', 'q8:D', 'q10:B'])
const keyQuestionIds = new Set(['q5', 'q8', 'q10'])

const createEmptyScores = (): ScoreBoard =>
  Object.fromEntries(archetypePriority.map((id) => [id, 0])) as ScoreBoard

const getSelectedOption = (answer: QuizAnswer) => {
  const question = questions.find((item) => item.id === answer.questionId)
  return question?.options.find((item) => item.id === answer.optionId)
}

const getKeyQuestionHitCount = (answers: QuizAnswer[], archetypeId: RegularArchetypeId) =>
  answers.filter((answer) => keyQuestionIds.has(answer.questionId) && getSelectedOption(answer)?.scores.includes(archetypeId))
    .length

const getRegularMatches = (scores: ScoreBoard, answers: QuizAnswer[]): PersonaMatch[] =>
  regularArchetypeIds
    .map((code) => ({
      code,
      rawScore: scores[code],
      matchRate: Math.round((scores[code] / personaMaxScores[code]) * 100),
      keyHits: getKeyQuestionHitCount(answers, code),
    }))
    .sort((left, right) => {
      if (right.matchRate !== left.matchRate) return right.matchRate - left.matchRate
      if (right.rawScore !== left.rawScore) return right.rawScore - left.rawScore
      if (right.keyHits !== left.keyHits) return right.keyHits - left.keyHits
      return regularArchetypeIds.indexOf(left.code) - regularArchetypeIds.indexOf(right.code)
    })
    .map(({ code, rawScore, matchRate }) => ({ code, rawScore, matchRate }))

const getDimensionRates = (scores: ScoreBoard): DimensionRates => {
  const sideScores: Record<DimensionSide, number> = {
    收: 0,
    放: 0,
    撤: 0,
    扛: 0,
    缓: 0,
    爆: 0,
    正: 0,
    偏: 0,
  }

  for (const archetypeId of regularArchetypeIds) {
    for (const side of personaDimensions[archetypeId]) {
      sideScores[side] += scores[archetypeId]
    }
  }

  const pairRate = (left: DimensionSide, right: DimensionSide) => {
    const total = sideScores[left] + sideScores[right]
    if (total === 0) return [50, 50] as const
    const leftRate = Math.round((sideScores[left] / total) * 100)
    return [leftRate, 100 - leftRate] as const
  }

  const [shou, fang] = pairRate('收', '放')
  const [che, kang] = pairRate('撤', '扛')
  const [huan, bao] = pairRate('缓', '爆')
  const [zheng, pian] = pairRate('正', '偏')

  return { shou, fang, che, kang, huan, bao, zheng, pian }
}

export const scoreAnswers = (answers: QuizAnswer[]): ScoreResult => {
  const scores = createEmptyScores()
  let hiddenHitCount = 0

  for (const answer of answers) {
    const option = getSelectedOption(answer)

    if (!option) {
      continue
    }

    if (hiddenMarkerAnswers.has(`${answer.questionId}:${answer.optionId}`)) {
      hiddenHitCount += 1
    }

    for (const archetypeId of option.scores) {
      scores[archetypeId] += 1
    }
  }

  const hiddenTriggered = hiddenHitCount >= 4
  scores[hiddenArchetypeId] = hiddenTriggered ? hiddenHitCount : 0
  const regularMatches = getRegularMatches(scores, answers)
  const hiddenMatch: PersonaMatch = { code: hiddenArchetypeId, rawScore: hiddenHitCount, matchRate: 100 }
  const topPersonas = hiddenTriggered ? [hiddenMatch, ...regularMatches.slice(0, 2)] : regularMatches.slice(0, 3)
  const primaryMatch = topPersonas[0]

  return {
    winner: primaryMatch.code,
    scores,
    answeredCount: answers.length,
    hiddenTriggered,
    hiddenHitCount,
    primaryRawScore: primaryMatch.rawScore,
    primaryMatchRate: primaryMatch.matchRate,
    topPersonas,
    dimensionRates: getDimensionRates(scores),
  }
}

export const isQuizComplete = (answers: QuizAnswer[]) => answers.length === questions.length

export const getAnswerForQuestion = (answers: QuizAnswer[], questionId: string) =>
  answers.find((answer) => answer.questionId === questionId)