import { useEffect, useRef, useState } from 'react'
import type { Question } from '../../shared/types.ts'

interface Props {
  question: Question
  index: number
  total: number
  /** מתי השאלה נגמרת, בשעון המקומי של המכשיר */
  endsAt: number
  timeLimitMs: number
  /** מה השחקן בחר, אם כבר בחר */
  selected: number | null
  /** התשובה הנכונה, רק אחרי שהשאלה נסגרה */
  revealed: number | null
  onAnswer: (choiceIndex: number, elapsedMs: number) => void
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

  function choose(choiceIndex: number) {
    if (locked) return
    onAnswer(choiceIndex, Date.now() - shownAt.current)
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
        {question.hint && <p className="mt-2 text-sm text-white/40">{question.hint}</p>}
      </div>

      {question.audioClip && <AudioClip src={question.audioClip} questionId={question.id} />}

      <div className="grid min-h-0 flex-1 content-center gap-3">
        {question.choices.map((choice, i) => (
          <ChoiceButton
            key={`${question.id}:${i}`}
            label={choice}
            index={i}
            selected={selected === i}
            state={
              revealed === null
                ? 'open'
                : i === revealed
                  ? 'correct'
                  : selected === i
                    ? 'wrong'
                    : 'dimmed'
            }
            onClick={() => choose(i)}
          />
        ))}
      </div>

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

function AudioClip({ src, questionId }: { src: string; questionId: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = audio.current
    if (!el) return
    el.currentTime = 0
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false)) // דפדפנים חוסמים ניגון אוטומטי לפני מגע
    return () => el.pause()
  }, [questionId])

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gold/30 bg-gold/5 p-4">
      <audio ref={audio} src={src} preload="auto" onEnded={() => setPlaying(false)} />
      <button
        type="button"
        onClick={() => {
          const el = audio.current
          if (!el) return
          el.currentTime = 0
          el.play().then(() => setPlaying(true))
        }}
        className="grid h-12 w-12 place-items-center rounded-full bg-gold text-2xl text-night"
        aria-label="נגן שוב"
      >
        {playing ? '♪' : '▶'}
      </button>
      <span className="text-sm text-white/60">{playing ? 'מתנגן...' : 'לחצו לשמוע שוב'}</span>
    </div>
  )
}
