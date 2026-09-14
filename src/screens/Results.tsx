import type { PlayerView } from '../../shared/protocol.ts'
import type { SoloResult } from './SoloGame.tsx'

interface Props {
  solo?: SoloResult
  leaderboard?: PlayerView[]
  playerId?: string | null
  isHost?: boolean
  onPlayAgain: () => void
  onHome: () => void
}

export function Results({ solo, leaderboard, playerId, isHost, onPlayAgain, onHome }: Props) {
  return (
    <div className="flex min-h-dvh flex-col justify-center gap-8 py-10">
      {solo && <SoloSummary result={solo} />}
      {leaderboard && <Leaderboard players={leaderboard} playerId={playerId} />}

      <div className="grid gap-2">
        {(!leaderboard || isHost) && (
          <button type="button" onClick={onPlayAgain} className="btn-gold py-4 text-lg">
            עוד סיבוב
          </button>
        )}
        {leaderboard && !isHost && (
          <p className="py-2 text-center text-white/50">מחכים שהמארח יתחיל סיבוב חדש...</p>
        )}
        <button type="button" onClick={onHome} className="btn-ghost">
          למסך הבית
        </button>
      </div>
    </div>
  )
}

function SoloSummary({ result }: { result: SoloResult }) {
  const ratio = result.total ? result.correct / result.total : 0
  return (
    <div className="text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-gold/60">התוצאה</p>
      <div className="my-3 text-6xl font-black text-gold">{result.score.toLocaleString('he-IL')}</div>
      <p className="text-lg text-white/70">
        {result.correct} מתוך {result.total} נכון
      </p>
      {result.bestStreak >= 3 && (
        <p className="mt-1 text-sm text-white/40">הרצף הכי ארוך: {result.bestStreak}</p>
      )}
      <p className="mt-5 text-xl font-bold">{verdict(ratio)}</p>
    </div>
  )
}

function Leaderboard({ players, playerId }: { players: PlayerView[]; playerId?: string | null }) {
  const medals = ['🥇', '🥈', '🥉']
  return (
    <div>
      <h1 className="mb-4 text-center text-3xl font-black">הטבלה הסופית</h1>
      <ol className="card divide-y divide-night-line">
        {players.map((player, i) => (
          <li
            key={player.id}
            className={`flex items-center gap-3 px-4 py-4 ${
              player.id === playerId ? 'bg-gold/5 text-gold' : ''
            }`}
          >
            <span className="w-8 text-center text-xl">{medals[i] ?? i + 1}</span>
            <span className="flex-1 text-lg font-bold">{player.nickname}</span>
            <span className="text-lg font-black">{player.score.toLocaleString('he-IL')}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function verdict(ratio: number): string {
  if (ratio === 1) return 'הכל נכון. אתה אייל גולן בעצמו?'
  if (ratio >= 0.8) return 'פצצה. אתה מכיר אותו טוב'
  if (ratio >= 0.6) return 'יפה מאוד, יש בסיס'
  if (ratio >= 0.4) return 'לא רע, אבל יש עוד לאן'
  if (ratio >= 0.2) return 'צריך לשמוע עוד קצת רדיו'
  return 'בוא נודה, לא באת בשביל אייל'
}
