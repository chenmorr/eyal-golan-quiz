import { useEffect, useMemo, useRef, useState } from 'react'
import { generateQuiz } from '../../shared/questions.ts'
import { scoreAnswer } from '../../shared/scoring.ts'
import type { RoomConfig } from '../../shared/protocol.ts'
import { QUESTION_TIME_MS } from '../../shared/protocol.ts'
import { SONGS } from '../data.ts'
import { QuestionCard, type Answer } from '../components/QuestionCard.tsx'
import { matchesAnswer } from '../../shared/answer-matching.ts'
import { isOpenQuestion } from '../../shared/types.ts'

interface Props {
  config: RoomConfig
  seed: string
  /** false כשאין רשת — אז שאלות אודיו לא נכנסות */
  allowAudio: boolean
  onFinish: (result: SoloResult) => void
  onQuit: () => void
}

export interface SoloResult {
  score: number
  correct: number
  total: number
  bestStreak: number
}

export function SoloGame({ config, seed, allowAudio, onFinish, onQuit }: Props) {
  const questions = useMemo(
    () => generateQuiz(SONGS, { seed, ...config, allowAudio }),
    [seed, config, allowAudio],
  )

  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Answer | null>(null)
  const [revealed, setRevealed] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0)
  const bestStreak = useRef(0)
  const [lastPoints, setLastPoints] = useState(0)
  // הטיימר צריך נקודת התחלה חדשה בכל שאלה
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now())

  const question = questions[index]
  // שאלה פתוחה מקבלת יותר זמן, כי צריך להקליד ולא רק ללחוץ
  const limitMs = question?.timeLimitMs ?? QUESTION_TIME_MS

  if (!question) {
    return (
      <div className="grid min-h-dvh place-items-center py-10 text-center">
        <div className="grid gap-4">
          <p className="text-white/60">לא הצלחנו לבנות חידון מהסינון הזה.</p>
          <button type="button" onClick={onQuit} className="btn-ghost">
            חזרה
          </button>
        </div>
      </div>
    )
  }

  function answer(given: Answer, elapsedMs: number) {
    // ויתור נחשב שגוי, אבל מקדם את המשחק במקום להשאיר את השחקן תקוע
    const isCorrect = given.skipped
      ? false
      : isOpenQuestion(question)
        ? matchesAnswer(given.text ?? '', question.accepted ?? []).correct
        : given.choiceIndex === question.answerIndex
    const { points } = scoreAnswer({
      correct: isCorrect,
      elapsedMs,
      limitMs,
      streak,
    })

    const nextStreak = isCorrect ? streak + 1 : 0
    bestStreak.current = Math.max(bestStreak.current, nextStreak)

    setSelected(given)
    setRevealed(question.answerIndex)
    setScore((s) => s + points)
    setLastPoints(points)
    setStreak(nextStreak)
    if (isCorrect) setCorrect((c) => c + 1)
  }

  function timeUp() {
    if (revealed !== null) return
    setSelected({ choiceIndex: -1 }) // לא ענה בזמן
    setRevealed(question.answerIndex)
    setStreak(0)
    setLastPoints(0)
  }

  function advance() {
    if (index + 1 >= questions.length) {
      onFinish({
        score,
        correct,
        total: questions.length,
        bestStreak: bestStreak.current,
      })
      return
    }
    setIndex((i) => i + 1)
    setSelected(null)
    setRevealed(null)
    setQuestionStartedAt(Date.now())
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onQuit} className="text-sm text-white/40 hover:text-white">
          יציאה
        </button>
        <div className="text-right">
          <div className="text-2xl font-black text-gold">{score.toLocaleString('he-IL')}</div>
          {streak >= 2 && <div className="text-xs text-gold/60">{streak} ברצף</div>}
        </div>
      </div>

      <div className="flex-1">
        <QuestionCard
          question={question}
          index={index}
          total={questions.length}
          endsAt={questionStartedAt + limitMs}
          timeLimitMs={limitMs}
          selected={selected}
          revealed={revealed}
          onAnswer={answer}
        />
      </div>

      {revealed === null ? (
        <TimeoutWatch startedAt={questionStartedAt} limitMs={limitMs} onTimeout={timeUp} />
      ) : (
        <div className="grid gap-2 animate-fade-up">
          {lastPoints > 0 && (
            <p className="text-center font-bold text-gold">+{lastPoints.toLocaleString('he-IL')}</p>
          )}
          <button type="button" onClick={advance} className="btn-gold py-4 text-lg">
            {index + 1 >= questions.length ? 'לתוצאות' : 'לשאלה הבאה'}
          </button>
        </div>
      )}
    </div>
  )
}

/** סוגר את השאלה כשנגמר הזמן, גם אם השחקן פשוט הניח את הטלפון */
function TimeoutWatch({
  startedAt,
  limitMs,
  onTimeout,
}: {
  startedAt: number
  limitMs: number
  onTimeout: () => void
}) {
  const callback = useRef(onTimeout)
  callback.current = onTimeout

  useEffect(() => {
    const remaining = Math.max(startedAt + limitMs - Date.now(), 0)
    const timer = setTimeout(() => callback.current(), remaining)
    return () => clearTimeout(timer)
  }, [startedAt, limitMs])

  return <div className="h-14" />
}
