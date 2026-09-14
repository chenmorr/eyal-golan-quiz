import { describe, expect, it } from 'vitest'
import songsJson from '../data/songs.json'
import { generateQuiz, buildPool } from '../shared/questions.ts'
import { scoreAnswer, sanitizeElapsed, BASE_POINTS, MAX_SPEED_BONUS } from '../shared/scoring.ts'
import { createRng, makeRoomCode } from '../shared/rng.ts'
import type { Song } from '../shared/types.ts'

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

  it('בכל שאלה יש בדיוק תשובה נכונה אחת, והיא בתוך האפשרויות', () => {
    for (const q of quiz) {
      expect(q.answerIndex).toBeGreaterThanOrEqual(0)
      expect(q.answerIndex).toBeLessThan(q.choices.length)
      expect(q.choices[q.answerIndex]).toBeTruthy()
    }
  })

  it('לכל שאלה יש טקסט ואפשרויות לא ריקות', () => {
    for (const q of quiz) {
      expect(q.prompt.length).toBeGreaterThan(5)
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
        expect(q.choices[q.answerIndex]).toBeTruthy()
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
