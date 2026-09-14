import { useEffect, useMemo, useState } from 'react'
import { generateQuiz } from '../../shared/questions.ts'
import type { PlayerView, QuestionOutcome, RoomConfig } from '../../shared/protocol.ts'
import { SONGS } from '../data.ts'
import { QuestionCard } from '../components/QuestionCard.tsx'

interface Props {
  seed: string
  config: RoomConfig
  questionIndex: number
  endsAt: number
  timeLimitMs: number
  revealedAnswer: number | null
  outcomes: QuestionOutcome[]
  players: PlayerView[]
  playerId: string | null
  isHost: boolean
  onAnswer: (questionIndex: number, choiceIndex: number, elapsedMs: number) => void
  onNext: () => void
}

export function MultiGame({
  seed,
  config,
  questionIndex,
  endsAt,
  timeLimitMs,
  revealedAnswer,
  outcomes,
  players,
  playerId,
  isHost,
  onAnswer,
  onNext,
}: Props) {
  // אותו seed שהשרת שלח מייצר פה בדיוק את אותן שאלות שרצות אצל כל השאר.
  // השאלות עצמן אף פעם לא עוברות ברשת.
  const questions = useMemo(
    () => generateQuiz(SONGS, { seed, ...config }),
    [seed, config],
  )

  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => setSelected(null), [questionIndex])

  const question = questions[questionIndex]
  if (!question) return <div className="grid min-h-dvh place-items-center">רגע...</div>

  const answeredCount = players.filter((p) => p.answered).length
  const activeCount = players.filter((p) => p.connected).length
  const myOutcome = outcomes.find((o) => o.playerId === playerId)

  function answer(choiceIndex: number, elapsedMs: number) {
    setSelected(choiceIndex)
    onAnswer(questionIndex, choiceIndex, elapsedMs)
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 py-6">
      <div className="flex-1">
        <QuestionCard
          question={question}
          index={questionIndex}
          total={questions.length}
          endsAt={endsAt}
          timeLimitMs={timeLimitMs}
          selected={selected}
          revealed={revealedAnswer}
          onAnswer={answer}
          waitingNote={`${answeredCount} מתוך ${activeCount} ענו`}
        />
      </div>

      {revealedAnswer !== null && (
        <div className="animate-fade-up grid gap-3">
          {myOutcome && (
            <p
              className={`text-center text-lg font-black ${
                myOutcome.correct ? 'text-emerald-400' : 'text-white/40'
              }`}
            >
              {myOutcome.correct
                ? `+${myOutcome.points.toLocaleString('he-IL')}`
                : 'לא הפעם'}
            </p>
          )}

          <ol className="card divide-y divide-night-line">
            {outcomes.slice(0, 5).map((outcome, i) => (
              <li
                key={outcome.playerId}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                  outcome.playerId === playerId ? 'text-gold' : 'text-white/70'
                }`}
              >
                <span className="w-4 text-white/30">{i + 1}</span>
                <span className="flex-1 font-medium">{outcome.nickname}</span>
                {outcome.correct && (
                  <span className="text-xs text-white/35">
                    {(outcome.elapsedMs / 1000).toFixed(1)} שנ׳
                  </span>
                )}
                <span className="w-16 text-left font-bold">
                  {outcome.correct ? `+${outcome.points}` : '—'}
                </span>
              </li>
            ))}
          </ol>

          {isHost && (
            <button type="button" onClick={onNext} className="btn-ghost">
              לדלג לשאלה הבאה
            </button>
          )}
        </div>
      )}
    </div>
  )
}
