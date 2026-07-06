import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { questions } from '../data/questions'
import type { OptionId, QuizAnswer } from '../data/types'
import { scoreAnswers } from '../lib/scoring'

interface QuizState {
  answers: QuizAnswer[]
  currentIndex: number
  selectOption: (questionId: string, optionId: OptionId) => void
  goPrev: () => void
  goToQuestion: (index: number) => void
  resetQuiz: () => void
  getScore: () => ReturnType<typeof scoreAnswers>
}

const sortAnswers = (answers: QuizAnswer[]) =>
  [...answers].sort((a, b) => {
    const aIndex = questions.findIndex((question) => question.id === a.questionId)
    const bIndex = questions.findIndex((question) => question.id === b.questionId)

    return aIndex - bIndex
  })

export const useQuizStore = create<QuizState>()(
  persist(
    (set, get) => ({
      answers: [],
      currentIndex: 0,
      selectOption: (questionId, optionId) => {
        const existingAnswers = get().answers.filter((answer) => answer.questionId !== questionId)
        const nextAnswers = sortAnswers([...existingAnswers, { questionId, optionId }])
        const questionIndex = questions.findIndex((question) => question.id === questionId)

        set({
          answers: nextAnswers,
          currentIndex: Math.min(questionIndex + 1, questions.length - 1),
        })
      },
      goPrev: () => set((state) => ({ currentIndex: Math.max(state.currentIndex - 1, 0) })),
      goToQuestion: (index) => set({ currentIndex: Math.min(Math.max(index, 0), questions.length - 1) }),
      resetQuiz: () => set({ answers: [], currentIndex: 0 }),
      getScore: () => scoreAnswers(get().answers),
    }),
    {
      name: 'personality-escape-station-quiz',
      partialize: (state) => ({ answers: state.answers, currentIndex: state.currentIndex }),
    },
  ),
)