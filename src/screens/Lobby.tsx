import { useEffect } from 'react'
import { MAX_PLAYERS, type PlayerView, type RoomConfig } from '../../shared/protocol.ts'
import { DIFFICULTY_LABELS } from '../data.ts'
import { unlockAudio } from '../audio-unlock.ts'

interface Props {
  code: string
  players: PlayerView[]
  config: RoomConfig
  isHost: boolean
  onStart: () => void
  onEditConfig: () => void
  onLeave: () => void
}

export function Lobby({ code, players, config, isHost, onStart, onEditConfig, onLeave }: Props) {
  const canStart = players.filter((p) => p.connected).length >= 1

  // אורח לא לוחץ על "מתחילים", אז פותחים לו את הנגן בכל מגע ראשון
  useEffect(() => {
    const open = () => unlockAudio()
    document.addEventListener('pointerdown', open, { once: true })
    return () => document.removeEventListener('pointerdown', open)
  }, [])

  async function share() {
    const text = `בוא נשחק חידון אייל גולן. קוד החדר: ${code}\n${location.origin}`
    // בטלפון זה פותח את תפריט השיתוף; במחשב פשוט מעתיק
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {
        // המשתמש ביטל, ממשיכים להעתקה
      }
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // אין הרשאה ללוח, הקוד ממילא מוצג גדול על המסך
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-6 py-8">
      <header className="text-center">
        <p className="text-sm text-white/40">קוד החדר</p>
        <div className="mt-1 text-6xl font-black tracking-[0.2em] text-gold">{code}</div>
        <button type="button" onClick={share} className="btn-ghost mt-4 text-sm">
          לשלוח לחברים
        </button>
      </header>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">
            בחדר ({players.length}/{MAX_PLAYERS})
          </h2>
          <span className="text-sm text-white/40">
            {config.questionCount} שאלות
            {config.eras?.length ? ` · ${config.eras.join(', ')}` : ''}
            {config.difficulties?.length
              ? ` · ${config.difficulties.map((d) => DIFFICULTY_LABELS[d]).join(', ')}`
              : ''}
          </span>
        </div>

        <ul className="grid gap-2">
          {players.map((player) => (
            <li
              key={player.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                player.connected
                  ? 'border-night-line bg-night'
                  : 'border-night-line/50 bg-night/40 text-white/30'
              }`}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-night-soft text-sm font-black text-gold">
                {player.nickname.slice(0, 1)}
              </span>
              <span className="flex-1 font-medium">{player.nickname}</span>
              {player.isHost && <span className="text-xs text-gold/70">מארח</span>}
              {!player.connected && <span className="text-xs">התנתק</span>}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-auto grid gap-2">
        {isHost ? (
          <>
            <button type="button" onClick={onEditConfig} className="btn-ghost">
              לשנות הגדרות
            </button>
            <button
              type="button"
              onClick={() => {
                unlockAudio()
                onStart()
              }}
              disabled={!canStart}
              className="btn-gold py-4 text-lg"
            >
              יאללה, מתחילים
            </button>
          </>
        ) : (
          <p className="py-4 text-center text-white/50">מחכים שהמארח יתחיל...</p>
        )}
        <button type="button" onClick={onLeave} className="text-sm text-white/30 hover:text-white">
          לצאת מהחדר
        </button>
      </div>
    </div>
  )
}
