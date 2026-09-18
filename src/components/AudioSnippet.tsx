import { useEffect, useRef, useState } from 'react'
import { getAudioElement } from '../audio-unlock.ts'

interface Props {
  src: string
  /** כמה שניות להשמיע. קצר יותר = קשה יותר */
  seconds: number
  /** מזהה השאלה — מאפס את הנגן כשעוברים שאלה */
  questionId: string
  /** מאיזו שנייה בקטע להתחיל */
  startAt?: number
  /** אחרי שהתשובה נחשפה מרשים להאזין לקטע במלואו */
  unlocked?: boolean
}

export function AudioSnippet({ src, seconds, questionId, startAt = 0, unlocked = false }: Props) {
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * המאזין שעוצר את הקטע. חייב להישמר כדי שאפשר יהיה להסיר אותו:
   * הנגן משותף לכל השאלות, ומאזין שנשאר משאלה קודמת עוצר את הקטע
   * הנוכחי בנקודה של הקטע הישן. זה מה שגרם לקטעים להיחתך אחרי
   * רבע שנייה ולתחושה ש"לא שומעים כלום".
   */
  const ticker = useRef<(() => void) | null>(null)
  const [playing, setPlaying] = useState(false)
  const [plays, setPlays] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [failed, setFailed] = useState(false)

  function clearStop() {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    if (ticker.current) {
      getAudioElement().removeEventListener('timeupdate', ticker.current)
      ticker.current = null
    }
  }

  function play() {
    const el = getAudioElement()
    clearStop()
    setFailed(false)

    const begin = () => {
      el.currentTime = startAt
      el
        .play()
        .then(() => {
          setPlaying(true)
          setBlocked(false)
          setPlays((n) => n + 1)

          if (unlocked) return

          // החיתוך נעשה לפי currentTime ולא לפי שעון.
          // עם שעון, שנייה של buffering נספרה כשנייה של מוזיקה,
          // והשחקן קיבל קטע של שתי שניות שממנו שמע חצי — או כלום.
          const stopAt = startAt + seconds
          const onTick = () => {
            if (el.currentTime >= stopAt) {
              el.pause()
              clearStop()
              setPlaying(false)
            }
          }
          ticker.current = onTick
          el.addEventListener('timeupdate', onTick)

          // רשת ביטחון למקרה ש-timeupdate לא נורה בכלל (קורה כשהניגון
          // נתקע): עוצרים לפי שעון, אבל בהרבה יותר מרווח
          stopTimer.current = setTimeout(
            () => {
              el.pause()
              clearStop()
              setPlaying(false)
            },
            (seconds + 8) * 1000,
          )
        })
        .catch(() => {
          setBlocked(true)
          setPlaying(false)
        })
    }

    // מחכים שיהיה מספיק מידע כדי לנגן רצוף, לא רק מטא-דאטה.
    // בלי זה הניגון מתחיל ונתקע מיד, ובקטע של שתי שניות זה הכל.
    if (el.readyState >= 3) begin()
    else {
      const onReady = () => {
        clearStop()
        begin()
      }
      el.addEventListener('canplaythrough', onReady, { once: true })
      // אם הרשת איטית, לא מחכים לנצח
      stopTimer.current = setTimeout(() => {
        el.removeEventListener('canplaythrough', onReady)
        if (el.readyState >= 1) begin()
        else setFailed(true)
      }, 4000)
    }
  }

  useEffect(() => {
    const el = getAudioElement()
    setPlays(0)
    setBlocked(false)
    setFailed(false)

    const onEnded = () => setPlaying(false)
    const onError = () => {
      setFailed(true)
      setPlaying(false)
    }
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)

    el.pause()
    el.src = src
    el.load()
    play()

    return () => {
      clearStop()
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
      el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, src])

  const status = failed
    ? 'הקטע לא נטען'
    : blocked
      ? 'לחצו להשמעה'
      : playing
        ? 'מתנגן...'
        : plays === 0
          ? 'לחצו להשמעה'
          : `הושמע ${plays} פעמים`

  return (
    <div
      className={`grid gap-2 rounded-xl border p-4 ${
        blocked || failed ? 'border-gold bg-gold/10' : 'border-gold/30 bg-gold/5'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={play}
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-2xl text-night
            ${blocked && !playing ? 'animate-pulse bg-gold-bright' : 'bg-gold'}`}
          aria-label="להשמיע שוב"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="flex-1">
          <div className="font-bold">{unlocked ? 'הקטע המלא' : `${seconds} שניות`}</div>
          <div className="text-sm text-white/50">{status}</div>
        </div>
      </div>

      {!unlocked && (
        <div className="h-1 overflow-hidden rounded-full bg-night-line">
          <div
            key={`${questionId}:${plays}`}
            className={playing ? 'h-full bg-gold' : 'h-full w-0 bg-gold'}
            style={playing ? { animation: `snippet ${seconds}s linear forwards` } : undefined}
          />
        </div>
      )}
    </div>
  )
}
