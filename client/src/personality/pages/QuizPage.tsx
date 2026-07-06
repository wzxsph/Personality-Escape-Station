import { useNavigate } from 'react-router-dom'
import { ProgressBar } from '../components/ProgressBar'
import { questions } from '../data/questions'
import type { OptionId } from '../data/types'
import { useQuizStore } from '../store/quizStore'
import styles from './QuizPage.module.css'

export function QuizPage() {
  const navigate = useNavigate()
  const answers = useQuizStore((state) => state.answers)
  const currentIndex = useQuizStore((state) => state.currentIndex)
  const selectOption = useQuizStore((state) => state.selectOption)
  const goPrev = useQuizStore((state) => state.goPrev)
  const currentQuestion = questions[Math.min(currentIndex, questions.length - 1)]
  const selectedOptionId = answers.find((answer) => answer.questionId === currentQuestion.id)?.optionId
  const isLastQuestion = currentIndex === questions.length - 1

  const handleSelect = (optionId: OptionId) => {
    selectOption(currentQuestion.id, optionId)
    navigate(isLastQuestion ? '/result' : '/quiz')
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} key={currentQuestion.id}>
        <ProgressBar current={currentIndex + 1} total={questions.length} />
        <div className={styles.navRow}>
          <button className={styles.backButton} type="button" onClick={goPrev} disabled={currentIndex === 0}>
            上一题
          </button>
          <span>正在搭建空间 {answers.length}/{questions.length}</span>
        </div>
        <div className={styles.questionBlock}>
          <p className={styles.kicker}>{currentQuestion.kicker}</p>
          <h1>{currentQuestion.title}</h1>
        </div>
        <div className={styles.options}>
          {currentQuestion.options.map((option) => (
            <button
              key={option.id}
              className={styles.optionButton}
              type="button"
              data-selected={selectedOptionId === option.id}
              onClick={() => handleSelect(option.id)}
            >
              <span>{option.id}</span>
              <strong>{option.text}</strong>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}