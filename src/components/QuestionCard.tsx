import { useEffect, useRef, useState } from 'react'
import type { Question } from '../../shared/types.ts'
import { isOpenQuestion } from '../../shared/types.ts'
import { matchesAnswer } from '../../shared/answer-matching.ts'
import { AudioSnippet } from './AudioSnippet.tsx'

/** מה השחקן ענה: בחירה מארבע אפשרויות, או טקסט שהקליד */
export interface Answer {
  choiceIndex: number
  text?: string
  /** ויתר במקום לנחש */
  skipped?: boolean
}

interface Props {
  question: Question
  index: number
  total: number
  /** מתי השאלה נגמרת, בשעון המקומי של המכשיר */
  endsAt: number
  timeLimitMs: number
  /** מה השחקן ענה, אם כבר ענה */
  selected: Answer | null
  /** התשובה הנכונה, רק אחרי שהשאלה נסגרה */
  revealed: number | null
  onAnswer: (answer: Answer, elapsedMs: number) => void
  /** מוצג מתחת לשאלה בזמן המתנה לשאר השחקנים */
  waitingNote?: string
}

export function QuestionCard({
  question,
  index,
  total,
  endsAt,
  timeLimitMs,
  selected,
  revealed,
  onAnswer,
  waitingNote,
}: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(endsAt - Date.now(), 0))
  // נקודת האפס של השחקן: מתי השאלה עלתה על המסך שלו. הזמן נמדד מפה
  // ולא בשרת, כדי שמי שיש לו אינטרנט איטי לא ייענש על זה.
  const shownAt = useRef(Date.now())

  useEffect(() => {
    shownAt.current = Date.now()
  }, [question.id])

  useEffect(() => {
    const tick = () => setRemaining(Math.max(endsAt - Date.now(), 0))
    tick()
    const timer = setInterval(tick, 100)
    return () => clearInterval(timer)
  }, [endsAt])

  const seconds = Math.ceil(remaining / 1000)
  const progress = Math.max(Math.min(remaining / timeLimitMs, 1), 0)
  const locked = selected !== null || revealed !== null
  const open = isOpenQuestion(question)

  function answer(a: Answer) {
    if (locked) return
    onAnswer(a, Date.now() - shownAt.current)
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <header className="flex items-center justify-between text-sm text-white/50">
        <span>
          שאלה {index + 1} מתוך {total}
        </span>
        <span className={seconds <= 5 ? 'font-bold text-wine-soft' : ''}>{seconds} שניות</span>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-night-line">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            progress > 0.25 ? 'bg-gold' : 'bg-wine-soft'
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="animate-fade-up">
        <h2 className="text-2xl font-black leading-tight sm:text-3xl">{question.prompt}</h2>
        {question.quote && (
          <blockquote
            className="mt-3 rounded-xl border-r-4 border-gold/60 bg-night-soft/70 px-4 py-3
              text-xl font-bold leading-snug text-gold-bright"
          >
            {question.quote}
          </blockquote>
        )}
        {question.hint && <p className="mt-2 text-sm text-white/40">{question.hint}</p>}
      </div>

      {question.audioClip && (
        <AudioSnippet
          src={question.audioClip}
          seconds={question.clipSeconds ?? 6}
          questionId={question.id}
          startAt={question.clipStart ?? 0}
          unlocked={revealed !== null}
        />
      )}

      {open ? (
        <OpenAnswer
          question={question}
          locked={locked}
          revealed={revealed !== null}
          submitted={selected?.text}
          skipped={!!selected?.skipped}
          onSubmit={(text) => answer({ choiceIndex: -1, text })}
          onSkip={() => answer({ choiceIndex: -1, skipped: true })}
        />
      ) : (
        <div className="grid min-h-0 flex-1 content-center gap-3">
          {question.choices.map((choice, i) => (
            <ChoiceButton
              key={`${question.id}:${i}`}
              label={choice}
              index={i}
              selected={selected?.choiceIndex === i}
              state={
                revealed === null
                  ? 'open'
                  : i === revealed
                    ? 'correct'
                    : selected?.choiceIndex === i
                      ? 'wrong'
                      : 'dimmed'
              }
              onClick={() => answer({ choiceIndex: i })}
            />
          ))}

          {!locked && (
            <button
              type="button"
              onClick={() => answer({ choiceIndex: -1, skipped: true })}
              className="mt-1 py-2 text-sm text-white/35 hover:text-white/60"
            >
              לא יודע, הלאה
            </button>
          )}
        </div>
      )}

      {revealed !== null && (
        <p className="animate-fade-up rounded-xl bg-night-soft/70 px-4 py-3 text-sm text-white/70">
          {question.reveal}
        </p>
      )}
      {revealed === null && selected !== null && waitingNote && (
        <p className="text-center text-sm text-white/40">{waitingNote}</p>
      )}
    </div>
  )
}

/** שדה הקלדה לשאלה פתוחה */
function OpenAnswer({
  question,
  locked,
  revealed,
  submitted,
  skipped,
  onSubmit,
  onSkip,
}: {
  question: Question
  locked: boolean
  revealed: boolean
  submitted?: string
  skipped: boolean
  onSubmit: (text: string) => void
  onSkip: () => void
}) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setText('')
  }, [question.id])

  const answered = submitted !== undefined || skipped
  const wasRight =
    submitted !== undefined && matchesAnswer(submitted, question.accepted ?? []).correct

  return (
    <div className="grid flex-1 content-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (locked || !text.trim()) return
          onSubmit(text.trim())
          input.current?.blur()
        }}
        className="grid gap-3"
      >
        <input
          ref={input}
          value={skipped ? 'ויתרתי' : (submitted ?? text)}
          onChange={(e) => setText(e.target.value)}
          disabled={locked}
          placeholder="שם השיר"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className={`field text-center text-xl font-bold ${
            answered
              ? wasRight
                ? 'border-emerald-400/70 text-emerald-100'
                : 'border-wine-soft text-white/70'
              : ''
          }`}
        />
        {!answered && (
          <>
            <button type="submit" disabled={!text.trim()} className="btn-gold py-4 text-lg">
              שולח
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="py-2 text-sm text-white/35 hover:text-white/60"
            >
              לא יודע, תגלו לי
            </button>
          </>
        )}
      </form>

      {revealed && (
        <div
          className={`animate-fade-up rounded-xl border p-4 text-center ${
            wasRight
              ? 'border-emerald-400/70 bg-emerald-500/10'
              : 'border-night-line bg-night-soft'
          }`}
        >
          <div className="text-xs text-white/40">{wasRight ? 'צדקת' : 'התשובה'}</div>
          <div className="mt-1 text-xl font-black">{question.correctLabel}</div>
        </div>
      )}
    </div>
  )
}

const LETTERS = ['א', 'ב', 'ג', 'ד']

function ChoiceButton({
  label,
  index,
  selected,
  state,
  onClick,
}: {
  label: string
  index: number
  selected: boolean
  state: 'open' | 'correct' | 'wrong' | 'dimmed'
  onClick: () => void
}) {
  const styles = {
    open: 'border-night-line bg-night-soft hover:border-gold/50 active:scale-[0.99]',
    correct: 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100',
    wrong: 'border-wine-soft bg-wine/25 text-white/80',
    dimmed: 'border-night-line bg-night-soft/40 text-white/35',
  }[state]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== 'open'}
      className={`flex w-full items-center gap-3 rounded-xl border p-4 text-right text-lg
        font-medium transition ${styles} ${selected && state === 'open' ? 'border-gold' : ''}`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black ${
          state === 'correct'
            ? 'bg-emerald-400 text-night'
            : state === 'wrong'
              ? 'bg-wine-soft text-white'
              : 'bg-night text-gold'
        }`}
      >
        {LETTERS[index] ?? index + 1}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}
