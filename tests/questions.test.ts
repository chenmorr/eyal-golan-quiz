import { describe, expect, it } from 'vitest'
import songsJson from '../data/songs.json'
import { generateQuiz, buildPool, availableKinds } from '../shared/questions.ts'
import { scoreAnswer, sanitizeElapsed, BASE_POINTS, MAX_SPEED_BONUS } from '../shared/scoring.ts'
import { createRng, makeRoomCode } from '../shared/rng.ts'
import { isOpenQuestion, type Song } from '../shared/types.ts'
import { matchesAnswer } from '../shared/answer-matching.ts'

const SONGS = songsJson as Song[]

describe('מאגר השירים', () => {
  it('יש מספיק שירים לחידון אמיתי', () => {
    expect(SONGS.length).toBeGreaterThan(300)
  })

  it('לכל שיר יש מזהה ייחודי', () => {
    const ids = new Set(SONGS.map((s) => s.id))
    expect(ids.size).toBe(SONGS.length)
  })

  it('אין שני שירים עם אותה כותרת', () => {
    const titles = SONGS.map((s) => s.title.trim())
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('כל שיר עם שנה נמצא בטווח הקריירה', () => {
    for (const song of SONGS) {
      if (song.year) expect(song.year).toBeGreaterThanOrEqual(1995)
    }
  })
})

describe('מחולל השאלות', () => {
  const quiz = generateQuiz(SONGS, { seed: 'test-seed', questionCount: 20 })

  it('מייצר את מספר השאלות שביקשו', () => {
    expect(quiz).toHaveLength(20)
  })

  it('אותו seed מחזיר בדיוק אותו חידון', () => {
    const again = generateQuiz(SONGS, { seed: 'test-seed', questionCount: 20 })
    expect(again).toEqual(quiz)
  })

  it('seed שונה מחזיר חידון שונה', () => {
    const other = generateQuiz(SONGS, { seed: 'other-seed', questionCount: 20 })
    expect(other).not.toEqual(quiz)
  })

  it('אין שאלה שחוזרת פעמיים באותו חידון', () => {
    const ids = quiz.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // הבדיקה שהכי חשובה: שאלה עם שתי תשובות זהות שוברת את החידון
  it('בכל שאלה כל האפשרויות שונות זו מזו', () => {
    for (const q of quiz) {
      expect(new Set(q.choices).size, `שאלה עם כפילות: ${q.prompt}`).toBe(q.choices.length)
    }
  })

  it('בכל שאלה סגורה יש בדיוק תשובה נכונה אחת, והיא בתוך האפשרויות', () => {
    for (const q of quiz.filter((q) => !isOpenQuestion(q))) {
      expect(q.answerIndex).toBeGreaterThanOrEqual(0)
      expect(q.answerIndex).toBeLessThan(q.choices.length)
      expect(q.choices[q.answerIndex]).toBeTruthy()
    }
  })

  it('בכל שאלה פתוחה יש תשובה קבילה ותווית להצגה', () => {
    for (const q of quiz.filter(isOpenQuestion)) {
      expect(q.accepted!.length).toBeGreaterThan(0)
      expect(q.correctLabel).toBeTruthy()
      expect(matchesAnswer(q.correctLabel!, q.accepted!).correct).toBe(true)
    }
  })

  it('לכל שאלה יש טקסט, ולשאלה סגורה גם אפשרויות לא ריקות', () => {
    for (const q of quiz) {
      expect(q.prompt.length).toBeGreaterThan(5)
      if (isOpenQuestion(q)) continue
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      for (const choice of q.choices) expect(choice.trim()).not.toBe('')
    }
  })

  it('לכל שאלה יש הסבר שנחשף אחרי התשובה', () => {
    for (const q of quiz) expect(q.reveal.length).toBeGreaterThan(5)
  })

  // רצים על הרבה seeds כדי לתפוס תבניות נדירות שספיצה אחת מפספסת
  it('שומר על התקינות לאורך מאה חידונים', () => {
    for (let i = 0; i < 100; i++) {
      for (const q of generateQuiz(SONGS, { seed: `seed-${i}`, questionCount: 10 })) {
        expect(new Set(q.choices).size, `כפילות ב-seed-${i}: ${q.prompt}`).toBe(q.choices.length)
        if (isOpenQuestion(q)) {
          expect(matchesAnswer(q.correctLabel!, q.accepted!).correct).toBe(true)
        } else {
          expect(q.choices[q.answerIndex]).toBeTruthy()
        }
      }
    }
  })

  it('שאלת שנה אף פעם לא מציעה את השנה הנכונה פעמיים', () => {
    for (let i = 0; i < 60; i++) {
      const yearQuestions = generateQuiz(SONGS, {
        seed: `year-${i}`,
        questionCount: 10,
        kinds: ['year'],
      })
      for (const q of yearQuestions) {
        const correct = q.choices[q.answerIndex]
        expect(q.choices.filter((c) => c === correct)).toHaveLength(1)
      }
    }
  })

  it('שאלת אלבום לא מציעה אלבום שהשיר באמת מופיע בו כמסיח', () => {
    const byTitle = new Map(SONGS.map((s) => [s.title, s]))
    for (let i = 0; i < 40; i++) {
      const questions = generateQuiz(SONGS, {
        seed: `album-${i}`,
        questionCount: 10,
        kinds: ['album'],
      })
      for (const q of questions) {
        const title = q.prompt.match(/"(.+)"/)?.[1]
        const song = title && byTitle.get(title)
        if (!song) continue
        const wrong = q.choices.filter((_, idx) => idx !== q.answerIndex)
        for (const choice of wrong) {
          expect(song.otherAlbums, `"${title}" באמת נמצא ב"${choice}"`).not.toContain(choice)
        }
      }
    }
  })

  it('מסנן לפי תקופה באמת מצמצם את המאגר', () => {
    const nineties = buildPool(SONGS, { seed: 'x', questionCount: 10, eras: ['שנות התשעים'] })
    expect(nineties.songs.length).toBeGreaterThan(0)
    expect(nineties.songs.length).toBeLessThan(SONGS.length)
    for (const song of nineties.songs) expect(song.era).toBe('שנות התשעים')
  })

  it('לא נתקע כשהסינון כמעט מרוקן את המאגר', () => {
    const quiz = generateQuiz(SONGS, {
      seed: 'narrow',
      questionCount: 20,
      eras: ['שנות התשעים'],
      difficulties: ['easy'],
      kinds: ['feature'],
    })
    expect(Array.isArray(quiz)).toBe(true)
  })
})

describe('ניקוד', () => {
  const limit = 20_000

  it('תשובה שגויה לא נותנת כלום', () => {
    expect(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: limit, streak: 5 }).points).toBe(0)
  })

  it('מהיר מקבל יותר מאיטי, אבל שניהם מקבלים', () => {
    const fast = scoreAnswer({ correct: true, elapsedMs: 1000, limitMs: limit, streak: 0 })
    const slow = scoreAnswer({ correct: true, elapsedMs: 18_000, limitMs: limit, streak: 0 })
    expect(fast.points).toBeGreaterThan(slow.points)
    expect(slow.points).toBeGreaterThanOrEqual(BASE_POINTS)
  })

  it('תשובה ברגע האחרון עדיין שווה את הבסיס', () => {
    const last = scoreAnswer({ correct: true, elapsedMs: limit, limitMs: limit, streak: 0 })
    expect(last.points).toBe(BASE_POINTS)
  })

  it('התקרה היא בסיס ועוד בונוס מהירות מלא', () => {
    const instant = scoreAnswer({ correct: true, elapsedMs: 0, limitMs: limit, streak: 0 })
    expect(instant.points).toBe(BASE_POINTS + MAX_SPEED_BONUS)
  })

  it('רצף מוסיף נקודות אבל עם תקרה', () => {
    const short = scoreAnswer({ correct: true, elapsedMs: 5000, limitMs: limit, streak: 2 })
    const long = scoreAnswer({ correct: true, elapsedMs: 5000, limitMs: limit, streak: 99 })
    expect(long.points).toBeGreaterThan(short.points)
    expect(long.streakBonus).toBe(250)
  })

  // הזמן נמדד בטלפון של השחקן, אז חייבים לחסום ערכים לא אנושיים
  it('חוסם זמן תגובה בלתי אפשרי', () => {
    expect(sanitizeElapsed(0, limit)).toBe(250)
    expect(sanitizeElapsed(-9999, limit)).toBe(250)
    expect(sanitizeElapsed(999_999, limit)).toBe(limit)
    expect(sanitizeElapsed('רמאות', limit)).toBe(limit)
    expect(sanitizeElapsed(NaN, limit)).toBe(limit)
  })
})

describe('קודי חדר', () => {
  it('בני ארבעה תווים ובלי אותיות מתחלפות', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode(createRng(`room-${i}`))
      expect(code).toHaveLength(4)
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/)
    }
  })
})

describe('בחירת סוגי שאלות', () => {
  it('בלי בחירה נכנסים כמה סוגים שונים', () => {
    const quiz = generateQuiz(SONGS, { seed: 'mix', questionCount: 20 })
    const kinds = new Set(quiz.map((q) => q.kind))
    expect(kinds.size).toBeGreaterThan(3)
  })

  it('בחירת סוג אחד מחזירה רק אותו', () => {
    for (const kind of ['year', 'album', 'feature', 'which-first'] as const) {
      const quiz = generateQuiz(SONGS, { seed: `only-${kind}`, questionCount: 8, kinds: [kind] })
      expect(quiz.length, `לא נוצרו שאלות מסוג ${kind}`).toBeGreaterThan(0)
      for (const q of quiz) expect(q.kind).toBe(kind)
    }
  })

  it('בחירת שני סוגים מחזירה רק אותם', () => {
    const quiz = generateQuiz(SONGS, {
      seed: 'two-kinds',
      questionCount: 15,
      kinds: ['year', 'album'],
    })
    expect(quiz.length).toBeGreaterThan(0)
    for (const q of quiz) expect(['year', 'album']).toContain(q.kind)
  })

  it('שאלות מילים פעילות עכשיו כשיש שורות במאגר', () => {
    const kinds = availableKinds(SONGS, { seed: 'x', questionCount: 10 })
    expect(kinds).toContain('lyric')
    expect(kinds).toContain('lyric-open')
  })

  it('שאלות מילים לא מוצעות כשאין שורות', () => {
    const noLyrics = SONGS.map((s) => ({ ...s, lyricLine: undefined }))
    const kinds = availableKinds(noLyrics, { seed: 'x', questionCount: 10 })
    expect(kinds).not.toContain('lyric')
    expect(kinds).not.toContain('lyric-open')
  })

  it('שאלות אודיו מוצעות עכשיו כשיש קטעים במאגר', () => {
    const kinds = availableKinds(SONGS, { seed: 'x', questionCount: 10 })
    expect(kinds).toContain('audio-open')
  })

  it('בחירת סוג יחד עם תקופה מכבדת את שניהם', () => {
    const quiz = generateQuiz(SONGS, {
      seed: 'combo',
      questionCount: 6,
      kinds: ['year'],
      eras: ['שנות התשעים'],
    })
    for (const q of quiz) expect(q.kind).toBe('year')
  })
})

describe('שאלת אודיו פתוחה', () => {
  const openQuiz = generateQuiz(SONGS, {
    seed: 'audio-open',
    questionCount: 12,
    kinds: ['audio-open'],
  })

  it('נוצרות שאלות כאלה', () => {
    expect(openQuiz.length).toBeGreaterThan(0)
    for (const q of openQuiz) expect(q.kind).toBe('audio-open')
  })

  it('לכל שאלה יש קטע אודיו', () => {
    for (const q of openQuiz) expect(q.audioClip).toMatch(/^https?:\/\//)
  })

  it('אין אפשרויות בחירה — מקלידים', () => {
    for (const q of openQuiz) {
      expect(q.choices).toHaveLength(0)
      expect(q.answerIndex).toBe(-1)
      expect(isOpenQuestion(q)).toBe(true)
    }
  })

  it('אורך הקטע נגזר מרמת הקושי', () => {
    const expected = { easy: 6, medium: 4, hard: 2 }
    for (const q of openQuiz) {
      expect(q.clipSeconds, `קושי ${q.difficulty}`).toBe(expected[q.difficulty])
    }
  })

  it('השם הנכון תמיד מתקבל כתשובה', () => {
    for (const q of openQuiz) {
      expect(matchesAnswer(q.correctLabel!, q.accepted!).correct).toBe(true)
    }
  })

  it('שיר אחר לא מתקבל', () => {
    for (const q of openQuiz) {
      const other = SONGS.find((s) => s.title !== q.correctLabel)!
      expect(matchesAnswer(other.title, q.accepted!).correct).toBe(false)
    }
  })

  it('הבחירה הכי קשה נותנת שתי שניות', () => {
    const hard = generateQuiz(SONGS, {
      seed: 'hard-only',
      questionCount: 6,
      kinds: ['audio-open'],
      difficulties: ['hard'],
    })
    expect(hard.length).toBeGreaterThan(0)
    for (const q of hard) expect(q.clipSeconds).toBe(2)
  })

  it('הבחירה הקלה נותנת שש שניות', () => {
    const easy = generateQuiz(SONGS, {
      seed: 'easy-only',
      questionCount: 6,
      kinds: ['audio-open'],
      difficulties: ['easy'],
    })
    expect(easy.length).toBeGreaterThan(0)
    for (const q of easy) expect(q.clipSeconds).toBe(6)
  })

  it('הסוג מוצע רק כשיש אודיו במאגר', () => {
    expect(availableKinds(SONGS, { seed: 'x', questionCount: 10 })).toContain('audio-open')
    const noAudio = SONGS.map((s) => ({ ...s, audioClip: undefined }))
    expect(availableKinds(noAudio, { seed: 'x', questionCount: 10 })).not.toContain('audio-open')
  })
})

describe('זמן מענה לפי סוג שאלה', () => {
  it('שאלה פתוחה מקבלת יותר זמן מהרגיל', () => {
    const open = generateQuiz(SONGS, { seed: 'time', questionCount: 5, kinds: ['audio-open'] })
    for (const q of open) expect(q.timeLimitMs).toBe(35_000)
  })

  it('שאלה עם ארבע אפשרויות נשארת בזמן הרגיל', () => {
    const closed = generateQuiz(SONGS, { seed: 'time2', questionCount: 5, kinds: ['year'] })
    for (const q of closed) expect(q.timeLimitMs).toBeUndefined()
  })
})

describe('התנהגות בלי רשת', () => {
  it('שאלות אודיו לא נכנסות כשאין רשת', () => {
    const quiz = generateQuiz(SONGS, { seed: 'offline', questionCount: 20, allowAudio: false })
    expect(quiz.length).toBeGreaterThan(0)
    for (const q of quiz) {
      expect(q.audioClip).toBeUndefined()
      expect(['audio', 'audio-open']).not.toContain(q.kind)
    }
  })

  it('הסוגים שדורשים אודיו לא מוצעים בהגדרות כשאין רשת', () => {
    const kinds = availableKinds(SONGS, { seed: 'x', questionCount: 10, allowAudio: false })
    expect(kinds).not.toContain('audio')
    expect(kinds).not.toContain('audio-open')
    expect(kinds).toContain('year')
  })

  it('כשיש רשת הם כן מוצעים', () => {
    const kinds = availableKinds(SONGS, { seed: 'x', questionCount: 10 })
    expect(kinds).toContain('audio-open')
  })
})

describe('שאלות אודיו לא מסגירות את התשובה', () => {
  it('"נחש את השיר" רק על שירים שלא שרים את שמם', () => {
    for (const kind of ['audio-open', 'audio'] as const) {
      const byTitle = new Map(SONGS.map((s) => [s.title, s]))
      for (let i = 0; i < 40; i++) {
        const quiz = generateQuiz(SONGS, { seed: `safe-${kind}-${i}`, questionCount: 8, kinds: [kind] })
        for (const q of quiz) {
          const title = q.correctLabel ?? q.choices[q.answerIndex]
          const song = byTitle.get(title)
          expect(song?.titleInLyrics, `"${title}" שר את שמו ונשאל "איזה שיר זה"`).toBe(false)
        }
      }
    }
  })

  it('שאלות על הקטע שלא מסגירות כן משתמשות בכל השירים', () => {
    const quiz = generateQuiz(SONGS, {
      seed: 'anyaudio',
      questionCount: 20,
      kinds: ['audio-album', 'audio-year'],
    })
    expect(quiz.length).toBeGreaterThan(10)
    for (const q of quiz) expect(q.audioClip).toBeTruthy()
  })

  it('שורת מילים אף פעם לא מכילה את שם השיר', () => {
    for (const song of SONGS.filter((s) => s.lyricLine)) {
      const line = song.lyricLine!.toLowerCase()
      const title = song.title.toLowerCase()
      expect(line.includes(title), `"${song.title}": השורה מכילה את השם`).toBe(false)
    }
  })
})

describe('גיוון החידון', () => {
  it('יש הרבה יותר מעשרה סוגי שאלות', () => {
    expect(availableKinds(SONGS, { seed: 'x', questionCount: 10 }).length).toBeGreaterThanOrEqual(14)
  })

  it('חידון של עשר שאלות מגוון בסוגים', () => {
    for (let i = 0; i < 30; i++) {
      const quiz = generateQuiz(SONGS, { seed: `var-${i}`, questionCount: 10 })
      const kinds = new Set(quiz.map((q) => q.kind))
      expect(kinds.size, `חידון ${i} מונוטוני`).toBeGreaterThanOrEqual(4)
    }
  })

  it('חמישה חידונים רצופים לא חוזרים על אותן שאלות', () => {
    const seen = new Map<string, number>()
    for (let i = 0; i < 5; i++) {
      for (const q of generateQuiz(SONGS, { seed: `sess-${i}`, questionCount: 10 })) {
        seen.set(q.id, (seen.get(q.id) ?? 0) + 1)
      }
    }
    const repeated = [...seen.values()].filter((n) => n > 1).length
    // עד חמש חזרות מתוך חמישים שאלות זה סביר; יותר מזה מורגש
    expect(repeated).toBeLessThanOrEqual(5)
  })
})
