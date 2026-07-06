import { questions } from '../src/personality/data/questions'
import { personaMaxScores, regularArchetypeIds, type QuizAnswer } from '../src/personality/data/types'
import { scoreAnswers } from '../src/personality/lib/scoring'

const directedMisses = regularArchetypeIds.flatMap((target) => {
  const answers = questions.flatMap((question) => {
    const option = question.options.find((item) => item.scores.includes(target))
    return option ? [{ questionId: question.id, optionId: option.id }] : []
  })
  const result = scoreAnswers(answers)

  return result.winner === target && result.primaryMatchRate === 100 && result.primaryRawScore === personaMaxScores[target]
    ? []
    : [{ target, winner: result.winner, primaryMatchRate: result.primaryMatchRate }]
})

const hiddenAnswers: QuizAnswer[] = [
  { questionId: 'q2', optionId: 'C' },
  { questionId: 'q3', optionId: 'A' },
  { questionId: 'q6', optionId: 'B' },
  { questionId: 'q8', optionId: 'D' },
]
const hiddenResult = scoreAnswers(hiddenAnswers)

const issues = [
  ...directedMisses,
  ...(hiddenResult.winner === 'GL1T' ? [] : [{ target: 'GL1T', winner: hiddenResult.winner }]),
]

if (issues.length > 0) {
  console.error(JSON.stringify(issues, null, 2))
  process.exit(1)
}

console.log('Personality scoring verification passed.')
