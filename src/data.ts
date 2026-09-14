import raw from '../data/songs.json'
import type { Song } from '../shared/types.ts'

/**
 * מאגר השירים נצרב לתוך ה-bundle, לא נמשך מהרשת.
 * זה מה שמאפשר למשחק יחיד לעבוד גם כשאין קליטה בכלל.
 */
export const SONGS = raw as Song[]

export const ERAS = ['שנות התשעים', 'שנות האלפיים', 'העשור הקודם', 'השנים האחרונות'] as const

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export const KIND_LABELS: Record<string, string> = {
  year: 'באיזו שנה',
  album: 'מאיזה אלבום',
  'which-first': 'מה יצא קודם',
  'album-song': 'שיר מהאלבום',
  feature: 'דואטים',
  'title-track': 'שיר נושא',
  era: 'אלבום לפי שנה',
  'odd-one-out': 'מי לא שייך',
  audio: 'נחש את השיר',
  lyric: 'מאיפה השורה',
}

export const SONG_COUNT = SONGS.length
export const YEAR_RANGE = (() => {
  const years = SONGS.map((s) => s.year).filter((y): y is number => !!y)
  return { from: Math.min(...years), to: Math.max(...years) }
})()
