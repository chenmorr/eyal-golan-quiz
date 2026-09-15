import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  /** כמה שניות להשמיע. קצר יותר = קשה יותר */
  seconds: number
  /** מזהה השאלה — מאפס את הנגן כשעוברים שאלה */
  questionId: string
  /** אחרי שהתשובה נחשפה מרשים להאזין לקטע במלואו */
  unlocked?: boolean
}

export function AudioSnippet({ src, seconds, questionId, unlocked = false }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [plays, setPlays] = useState(0)
  const [blocked, setBlocked] = useState(false)

  function clearStop() {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
  }

  function play() {
    const el = audio.current
    if (!el) return
    clearStop()
    el.currentTime = 0
    el.play()
      .then(() => {
        setPlaying(true)
        setBlocked(false)
        setPlays((n) => n + 1)
        // חיתוך הקטע נעשה פה ולא בקובץ: אותו קטע משמש לכל רמות הקושי,
        // ורק משך ההשמעה משתנה
        if (!unlocked) {
          stopTimer.current = setTimeout(() => {
            el.pause()
            setPlaying(false)
          }, seconds * 1000)
        }
      })
      .catch(() => {
        // ספארי חוסם ניגון לפני מגע של המשתמש
        setBlocked(true)
        setPlaying(false)
      })
  }

  // מנסים להשמיע לבד ברגע שהשאלה עולה; אם הדפדפן חוסם, יש כפתור
  useEffect(() => {
    setPlays(0)
    play()
    return () => {
      clearStop()
      audio.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId])

  return (
    <div className="grid gap-2 rounded-xl border border-gold/30 bg-gold/5 p-4">
      <audio ref={audio} src={src} preload="auto" onEnded={() => setPlaying(false)} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={play}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gold text-2xl text-night"
          aria-label="להשמיע שוב"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="flex-1">
          <div className="font-bold">
            {unlocked ? 'הקטע המלא' : `${seconds} שניות`}
          </div>
          <div className="text-sm text-white/50">
            {blocked
              ? 'לחצו להשמעה'
              : playing
                ? 'מתנגן...'
                : plays === 0
                  ? 'לחצו להשמעה'
                  : `הושמע ${plays} פעמים`}
          </div>
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
