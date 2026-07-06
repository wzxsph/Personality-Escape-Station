import { questions } from '../src/personality/data/questions'
import { results } from '../src/personality/data/results'
import { hiddenArchetypeId, personaMaxScores, regularArchetypeIds } from '../src/personality/data/types'
import { scanRecord } from '../src/personality/lib/contentSafety'

const safetyIssues = [...scanRecord('questions', questions), ...scanRecord('results', results)]
const structureIssues: string[] = []

if (questions.length !== 10) {
  structureIssues.push(`expected 10 questions, got ${questions.length}`)
}

const optionCounts = Object.fromEntries(regularArchetypeIds.map((id) => [id, 0])) as Record<
  (typeof regularArchetypeIds)[number],
  number
>

for (const question of questions) {
  if (question.options.length !== 4) {
    structureIssues.push(`${question.id} expected 4 options, got ${question.options.length}`)
  }

  for (const option of question.options) {
    if (option.scores.length !== 1) {
      structureIssues.push(`${question.id}${option.id} expected 1 persona mapping, got ${option.scores.length}`)
    }

    for (const personaId of option.scores) {
      optionCounts[personaId] += 1
    }
  }
}

for (const personaId of regularArchetypeIds) {
  if (optionCounts[personaId] !== personaMaxScores[personaId]) {
    structureIssues.push(`${personaId} expected ${personaMaxScores[personaId]} options, got ${optionCounts[personaId]}`)
  }
}

if (results.length !== regularArchetypeIds.length + 1) {
  structureIssues.push(`expected 12 results, got ${results.length}`)
}

const resultIds = new Set(results.map((result) => result.id))
for (const personaId of [...regularArchetypeIds, hiddenArchetypeId]) {
  if (!resultIds.has(personaId)) {
    structureIssues.push(`missing result for ${personaId}`)
  }
}

const issues = [...safetyIssues, ...structureIssues]

if (issues.length > 0) {
  console.error(JSON.stringify(issues, null, 2))
  process.exit(1)
}

console.log('Personality content verification passed.')
