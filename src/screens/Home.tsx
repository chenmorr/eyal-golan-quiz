import { useState } from 'react'
import { SONG_COUNT, YEAR_RANGE } from '../data.ts'

interface Props {
  onSolo: () => void
  onHost: () => void
  onJoin: (code: string, nickname: string) => void
  online: boolean
}

export function Home({ onSolo, onHost, onJoin, online }: Props) {
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState(() => localStorage.getItem('eyal-quiz-nickname') ?? '')

  function submitJoin(e: React.FormEvent) {
    e.preventDefault()
    if (code.trim().length < 4 || !nickname.trim()) return
    localStorage.setItem('eyal-quiz-nickname', nickname.trim())
    onJoin(code, nickname)
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-8 py-10">
      <header className="text-center">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-gold/70">החידון</p>
        <h1 className="mt-2 text-5xl font-black leading-none sm:text-6xl">אייל גולן</h1>
        <p className="mt-4 text-white/50">
          {SONG_COUNT} שירים, מ-{YEAR_RANGE.from} עד {YEAR_RANGE.to}. נראה כמה אתם באמת מכירים.
        </p>
      </header>

      {!joining ? (
        <div className="grid gap-3">
          <button type="button" onClick={onSolo} className="btn-gold py-4 text-lg">
            משחק לבד
          </button>
          <button
            type="button"
            onClick={onHost}
            disabled={!online}
            className="btn-ghost py-4 text-lg"
          >
            לפתוח משחק לחברים
          </button>
          <button
            type="button"
            onClick={() => setJoining(true)}
            disabled={!online}
            className="btn-ghost py-4 text-lg"
          >
            להצטרף עם קוד
          </button>

          {!online && (
            <p className="mt-2 text-center text-sm text-white/40">
              אין כרגע אינטרנט, אז משחק עם חברים לא זמין. משחק לבד עובד רגיל.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submitJoin} className="grid gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="קוד החדר"
            autoCapitalize="characters"
            autoComplete="off"
            className="field text-center text-3xl font-black tracking-[0.4em]"
          />
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder="איך קוראים לך"
            className="field"
          />
          <button
            type="submit"
            disabled={code.trim().length < 4 || !nickname.trim()}
            className="btn-gold py-4 text-lg"
          >
            יאללה, נכנסים
          </button>
          <button type="button" onClick={() => setJoining(false)} className="btn-ghost">
            חזרה
          </button>
        </form>
      )}
    </div>
  )
}
