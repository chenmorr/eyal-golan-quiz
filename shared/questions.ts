// מחולל השאלות.
//
// העיקרון: אף שאלה לא נכתבת ביד. כל שאלה נולדת מטבלת השירים לפי תבנית,
// אז שיר חדש שנכנס לטבלה מייצר עשרות שאלות חדשות בלי שאף אחד נוגע בקוד.
// כדי להוסיף סוג שאלה חדש מוסיפים אובייקט אחד למערך GENERATORS למטה.

import { createRng, pick, sample, shuffle, type Rng } from './rng.ts'
import { acceptedAnswers } from './answer-matching.ts'
import { OPEN_QUESTION_TIME_MS } from './protocol.ts'
import type { Difficulty, Question, QuestionKind, QuizConfig, Song } from './types.ts'

/** אוסף השירים אחרי סינון, עם אינדקסים מוכנים כדי לא לחשב מחדש בכל שאלה */
export interface Pool {
  songs: Song[]
  /** רק שירים עם שנה ואלבום — הבסיס לרוב השאלות */
  dated: Song[]
  byAlbum: Map<string, Song[]>
  albums: { title: string; year: number }[]
  years: number[]
  artists: string[]
  /** שירים עם אודיו שלא שרים את שמם — בטוחים לשאלת "איזה שיר זה" */
  audioSafe: Song[]
  /** כל שיר עם אודיו, כולל כאלה ששרים את שמם */
  audioAny: Song[]
  withLyrics: Song[]
  withNextLine: Song[]
  withGap: Song[]
  /** כל המילים שהוחסרו, מאגר המסיחים לשאלות ההשלמה */
  gapWords: string[]
}

export function buildPool(allSongs: Song[], config: QuizConfig): Pool {
  let songs = allSongs.filter((s) => !s.liveOnly)
  // בלי רשת אין קטעי אודיו, אז השירים נשארים אבל בלי הקישור —
  // וכך מחוללי האודיו פשוט לא מוצאים חומר ולא נכנסים לחידון
  if (config.allowAudio === false) songs = songs.map((s) => ({ ...s, audioClip: undefined }))
  if (config.eras?.length) songs = songs.filter((s) => s.era && config.eras!.includes(s.era))
  if (config.difficulties?.length) {
    songs = songs.filter((s) => config.difficulties!.includes(s.difficulty))
  }

  const dated = songs.filter((s): s is Song & { year: number; album: string } => !!s.year && !!s.album)

  const byAlbum = new Map<string, Song[]>()
  for (const song of dated) {
    const list = byAlbum.get(song.album!) ?? []
    list.push(song)
    byAlbum.set(song.album!, list)
  }

  const albumYear = new Map<string, number>()
  for (const song of dated) {
    const current = albumYear.get(song.album!)
    if (current === undefined || song.year! < current) albumYear.set(song.album!, song.year!)
  }

  // "אתניX" מופיע על עשרות שירים מהתקופה המוקדמת — הם היו הלהקה המלווה,
  // לא אורח מפתיע. כאורח בשאלה הוא הופך את התשובה לצפויה, אז הוא לא נחשב.
  const BACKING_BANDS = new Set(['אתניX', 'Ethnix'])
  const artists = [
    ...new Set(songs.flatMap((s) => s.features).filter((a) => !BACKING_BANDS.has(a))),
  ]

  const audioAny = songs.filter((s) => s.audioClip)

  return {
    songs,
    dated,
    byAlbum,
    audioAny,
    // titleInLyrics לא ידוע נחשב כאילו כן — עדיף לוותר על שיר
    // מאשר לשאול שאלה שהתשובה שלה נשמעת
    audioSafe: audioAny.filter((s) => s.titleInLyrics === false),
    withLyrics: songs.filter((s) => s.lyricLine),
    withNextLine: songs.filter((s) => s.nextLine),
    withGap: songs.filter((s) => s.gap),
    gapWords: [...new Set(songs.filter((s) => s.gap).map((s) => s.gap!.word))],
    albums: [...albumYear.entries()].map(([title, year]) => ({ title, year })),
    years: [...new Set(dated.map((s) => s.year!))].sort((a, b) => a - b),
    artists,
  }
}

/** תבנית של סוג שאלה אחד */
interface Generator {
  kind: QuestionKind
  /** משקל יחסי בהגרלה — סוגים כיפיים מקבלים יותר */
  weight: number
  ready(pool: Pool): boolean
  make(rng: Rng, pool: Pool, used: Set<string>): Question | null
  /**
   * כמה שאלות שונות הסוג הזה יכול בכלל לייצר מהמאגר הנוכחי.
   * זה מה שמונע את התחושה של "כבר ראיתי את זה": סוג שנשען על
   * עשרים שירים לא אמור להופיע באותה תדירות כמו סוג שנשען על
   * ארבע מאות, גם אם הוא כיפי יותר.
   */
  supply(pool: Pool): number
}

/**
 * משקל אחרי התחשבות בגודל המאגר. מתחת לסף הזה הסוג מדולל יחסית,
 * מעליו הוא מקבל את מלוא המשקל שלו.
 */
const HEALTHY_SUPPLY = 60

function effectiveWeight(g: Generator, pool: Pool): number {
  const supply = g.supply(pool)
  if (supply <= 0) return 0
  return g.weight * Math.min(1, supply / HEALTHY_SUPPLY)
}

/**
 * הנושא שהשחקן חווה, להבדיל מהסוג הטכני.
 *
 * שבעה סוגים שונים נוגעים באלבומים, וכשהם מוגרלים בנפרד יוצא חידון
 * שמרגיש כמו "עוד שאלה על אלבום" גם כשכל שאלה שונה טכנית. האיזון
 * נעשה לפי הנושא הזה, לא לפי הסוג.
 */
const THEME_OF: Record<QuestionKind, string> = {
  album: 'album',
  'album-song': 'album',
  'odd-one-out': 'album',
  era: 'album',
  'album-order': 'album',
  'audio-album': 'album',
  'title-track': 'album',
  year: 'year',
  'which-first': 'year',
  'audio-year': 'year',
  'audio-open': 'identify',
  audio: 'identify',
  'lyric-open': 'lyrics',
  lyric: 'lyrics',
  feature: 'guests',
  'guest-count': 'guests',
  'next-line': 'lyrics',
  'fill-gap': 'lyrics',
  // אלה נושא משלהם: הם על השוואה בין שירים, לא על עובדה בודדת
  oldest: 'trivia',
  longest: 'trivia',
  'real-or-fake': 'trivia',
}

/** אף נושא לא יתפוס יותר מהחלק הזה מהחידון */
const MAX_THEME_SHARE = 0.4

const yearLabel = (y: number) => String(y)

/**
 * כמה שניות אודיו משמיעים, לפי כמה השיר מוכר.
 * להיט מקבל שש שניות ועדיין קל; שיר נדיר מקבל שתיים וזה מבחן אמיתי.
 */
function clipLengthFor(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 6 : difficulty === 'medium' ? 4 : 2
}

/** בונה ארבע אפשרויות: התשובה הנכונה ועוד שלושה מסיחים, מעורבבות */
function choicesFrom(rng: Rng, correct: string, distractors: string[]): { choices: string[]; answerIndex: number } | null {
  const unique = [...new Set(distractors.filter((d) => d !== correct))]
  if (unique.length < 3) return null
  const choices = shuffle(rng, [correct, ...sample(rng, unique, 3)])
  return { choices, answerIndex: choices.indexOf(correct) }
}

const GENERATORS: Generator[] = [
  {
    // באיזו שנה יצא השיר
    kind: 'year',
    weight: 3,
      supply: (p) => p.dated.length,
    ready: (p) => p.dated.length >= 10 && p.years.length >= 4,
    make(rng, pool, used) {
      const song = pickUnused(rng, pool.dated, used)
      if (!song) return null
      // מסיחים משנים קרובות: רחוק מדי והתשובה מתנפלת מעצמה
      const near = pool.years.filter((y) => y !== song.year && Math.abs(y - song.year!) <= 7)
      const built = choicesFrom(rng, yearLabel(song.year!), near.map(yearLabel))
      if (!built) return null
      return {
        id: `year:${song.id}`,
        kind: 'year',
        prompt: `באיזו שנה יצא השיר "${song.title}"?`,
        ...built,
        difficulty: song.difficulty,
        reveal: `"${song.title}" יצא ב-${song.year} באלבום "${song.album}".`,
      }
    },
  },
  {
    // מאיזה אלבום השיר
    kind: 'album',
    weight: 3,
      supply: (p) => p.dated.length,
    ready: (p) => p.albums.length >= 4 && p.dated.length >= 10,
    make(rng, pool, used) {
      const song = pickUnused(rng, pool.dated, used)
      if (!song) return null
      // אסור שמסיח יהיה אלבום שהשיר באמת מופיע בו (אוספים, גרסאות)
      const forbidden = new Set([song.album!, ...song.otherAlbums])
      const near = pool.albums
        .filter((a) => !forbidden.has(a.title) && Math.abs(a.year - song.year!) <= 8)
        .map((a) => a.title)
      const built = choicesFrom(rng, song.album!, near)
      if (!built) return null
      return {
        id: `album:${song.id}`,
        kind: 'album',
        prompt: `מאיזה אלבום השיר "${song.title}"?`,
        ...built,
        difficulty: song.difficulty,
        reveal: `"${song.title}" יצא באלבום "${song.album}" (${song.year}).`,
      }
    },
  },
  {
    // מה יצא קודם
    kind: 'which-first',
    weight: 2,
      supply: (p) => p.dated.length,
    ready: (p) => p.dated.length >= 20,
    make(rng, pool, used) {
      const a = pickUnused(rng, pool.dated, used)
      if (!a) return null
      // פער של ארבע שנים לפחות, אחרת זה הימור ולא ידיעה
      const far = pool.dated.filter((s) => Math.abs(s.year! - a.year!) >= 4 && s.id !== a.id)
      if (!far.length) return null
      const b = pick(rng, far)
      const [first, second] = a.year! < b.year! ? [a, b] : [b, a]
      const choices = shuffle(rng, [a.title, b.title])
      return {
        id: `first:${[a.id, b.id].sort().join('|')}`,
        kind: 'which-first',
        prompt: 'איזה שיר יצא קודם?',
        choices,
        answerIndex: choices.indexOf(first.title),
        difficulty: Math.abs(a.year! - b.year!) >= 10 ? 'easy' : 'medium',
        reveal: `"${first.title}" יצא ב-${first.year}, "${second.title}" רק ב-${second.year}.`,
      }
    },
  },
  {
    // איזה מהשירים האלה מהאלבום הזה
    kind: 'album-song',
    weight: 2,
      supply: (p) => [...p.byAlbum.values()].filter((v) => v.length >= 2).length * 3,
    ready: (p) => [...p.byAlbum.values()].filter((v) => v.length >= 2).length >= 3,
    make(rng, pool, used) {
      const candidates = [...pool.byAlbum.entries()].filter(([, songs]) => songs.length >= 2)
      if (!candidates.length) return null
      const [album, songs] = pick(rng, candidates)
      const correct = pick(rng, songs)
      if (used.has(correct.id)) return null
      // מסיחים חייבים להיות שירים שלא מופיעים באלבום הזה בכלל
      const outside = pool.dated
        .filter((s) => s.album !== album && !s.otherAlbums.includes(album))
        .map((s) => s.title)
      const built = choicesFrom(rng, correct.title, outside)
      if (!built) return null
      used.add(correct.id)
      return {
        id: `albumsong:${correct.id}`,
        kind: 'album-song',
        prompt: `איזה מהשירים האלה מהאלבום "${album}"?`,
        ...built,
        difficulty: correct.difficulty,
        reveal: `"${correct.title}" נמצא באלבום "${album}" משנת ${correct.year}.`,
      }
    },
  },
  {
    // עם מי הוא שר את זה
    kind: 'feature',
    weight: 2,
      supply: (p) => p.songs.filter((s) => s.features.some((f) => p.artists.includes(f))).length,
    ready: (p) => p.artists.length >= 4,
    make(rng, pool, used) {
      const duets = pool.songs.filter(
        (s) => s.features.some((f) => pool.artists.includes(f)) && !used.has(s.id),
      )
      if (!duets.length) return null
      const song = pick(rng, duets)
      const guest = pick(rng, song.features.filter((f) => pool.artists.includes(f)))
      const built = choicesFrom(rng, guest, pool.artists)
      if (!built) return null
      used.add(song.id)
      return {
        id: `feature:${song.id}`,
        kind: 'feature',
        prompt: `עם מי אייל גולן שר את "${song.title}"?`,
        ...built,
        difficulty: song.difficulty,
        reveal: `"${song.title}" הוא דואט עם ${guest}${song.year ? ` משנת ${song.year}` : ''}.`,
      }
    },
  },
  {
    // איזה שיר נתן לאלבום את שמו
    kind: 'title-track',
    weight: 1,
      supply: (p) => p.dated.filter((s) => s.isTitleTrack).length,
    ready: (p) => p.songs.filter((s) => s.isTitleTrack).length >= 3,
    make(rng, pool, used) {
      const titleTracks = pool.dated.filter((s) => s.isTitleTrack && !used.has(s.id))
      if (!titleTracks.length) return null
      const song = pick(rng, titleTracks)
      // המסיחים הם שירים אחרים מאותו אלבום — ככה זה באמת מבחן ידע
      const sameAlbum = (pool.byAlbum.get(song.album!) ?? [])
        .filter((s) => s.id !== song.id)
        .map((s) => s.title)
      const built = choicesFrom(rng, song.title, sameAlbum)
      if (!built) return null
      used.add(song.id)
      return {
        id: `titletrack:${song.id}`,
        kind: 'title-track',
        prompt: `איזה שיר נתן לאלבום "${song.album}" את שמו?`,
        hint: 'כל האפשרויות מאותו אלבום',
        ...built,
        difficulty: 'hard',
        reveal: `האלבום "${song.album}" (${song.year}) נקרא על שם השיר "${song.title}".`,
      }
    },
  },
  {
    // איזה אלבום יצא בשנה הזאת
    kind: 'era',
    weight: 1,
      supply: (p) => p.albums.length,
    ready: (p) => p.albums.length >= 5,
    make(rng, pool, used) {
      const albums = pool.albums.filter((a) => !used.has(`album:${a.title}`))
      if (albums.length < 4) return null
      const target = pick(rng, albums)
      const others = pool.albums.filter((a) => a.year !== target.year).map((a) => a.title)
      const built = choicesFrom(rng, target.title, others)
      if (!built) return null
      used.add(`album:${target.title}`)
      return {
        id: `albumyear:${target.title}`,
        kind: 'era',
        prompt: `איזה אלבום של אייל גולן יצא בשנת ${target.year}?`,
        ...built,
        difficulty: 'medium',
        reveal: `"${target.title}" יצא ב-${target.year}.`,
      }
    },
  },
  {
    // איזה שיר לא שייך לחבורה
    kind: 'odd-one-out',
    weight: 1,
      supply: (p) => [...p.byAlbum.values()].filter((v) => v.length >= 3).length * 3,
    ready: (p) => [...p.byAlbum.values()].filter((v) => v.length >= 3).length >= 2,
    make(rng, pool, used) {
      const rich = [...pool.byAlbum.entries()].filter(([, songs]) => songs.length >= 3)
      if (!rich.length) return null
      const [album, songs] = pick(rng, rich)
      const three = sample(rng, songs, 3)
      const outsiders = pool.dated.filter(
        (s) => s.album !== album && !s.otherAlbums.includes(album) && !used.has(s.id),
      )
      if (!outsiders.length) return null
      const outsider = pick(rng, outsiders)
      const choices = shuffle(rng, [...three.map((s) => s.title), outsider.title])
      used.add(outsider.id)
      return {
        id: `odd:${outsider.id}:${album}`,
        kind: 'odd-one-out',
        prompt: `שלושה מהשירים האלה מהאלבום "${album}". איזה לא?`,
        choices,
        answerIndex: choices.indexOf(outsider.title),
        difficulty: 'hard',
        reveal: `"${outsider.title}" הוא מהאלבום "${outsider.album}" (${outsider.year}), לא מ"${album}".`,
      }
    },
  },
  {
    // נחש את השיר מהקטע והקלד את השם. בלי אפשרויות זה מבחן זיכרון אמיתי,
    // כי ארבע אפשרויות מסגירות את התשובה כמעט תמיד.
    //
    // רק שירים שלא שרים את שמם: הקטע של אפל מתחיל סביב הפזמון, ואם השם
    // מופיע במילים הוא נשמע באוזניים והשאלה מגלה את עצמה.
    kind: 'audio-open',
    weight: 3,
      supply: (p) => p.audioSafe.length,
    ready: (p) => p.audioSafe.length >= 1,
    make(rng, pool, used) {
      const withAudio = pool.audioSafe.filter((s) => !used.has(s.id))
      if (!withAudio.length) return null
      const song = pick(rng, withAudio)
      used.add(song.id)
      return {
        id: `audioopen:${song.id}`,
        kind: 'audio-open',
        prompt: 'איזה שיר זה?',
        hint: 'תקליטו את שם השיר. טעות כתיב קטנה עוברת',
        choices: [],
        answerIndex: -1,
        accepted: acceptedAnswers(song.title),
        correctLabel: song.title,
        difficulty: song.difficulty,
        audioClip: song.audioClip,
        clipSeconds: clipLengthFor(song.difficulty),
        timeLimitMs: OPEN_QUESTION_TIME_MS,
        reveal: `"${song.title}" מהאלבום "${song.album}" (${song.year}).`,
      }
    },
  },
  {
    // נחש את השיר מהקטע — נוצרת רק כשיש קבצי אודיו
    kind: 'audio',
    weight: 2,
      supply: (p) => p.audioSafe.length,
    ready: (p) => p.audioSafe.length >= 4,
    make(rng, pool, used) {
      const withAudio = pool.audioSafe.filter((s) => !used.has(s.id))
      if (!withAudio.length) return null
      const song = pick(rng, withAudio)
      const built = choicesFrom(rng, song.title, pool.songs.map((s) => s.title))
      if (!built) return null
      used.add(song.id)
      return {
        id: `audio:${song.id}`,
        kind: 'audio',
        prompt: 'איזה שיר זה?',
        hint: 'תקשיבו טוב',
        ...built,
        difficulty: song.difficulty,
        audioClip: song.audioClip,
        reveal: `"${song.title}" מהאלבום "${song.album}" (${song.year}).`,
      }
    },
  },
  {
    // מאיזה אלבום הקטע. עובד גם על שירים ששרים את שמם: לזהות את השיר
    // זה חצי מהדרך, עדיין צריך לדעת באיזה אלבום הוא יצא.
    kind: 'audio-album',
    weight: 3,
      supply: (p) => p.audioAny.length,
    ready: (p) => p.audioAny.length >= 4 && p.albums.length >= 4,
    make(rng, pool, used) {
      const candidates = pool.audioAny.filter((s) => s.album && s.year && !used.has(s.id))
      if (!candidates.length) return null
      const song = pick(rng, candidates)
      const forbidden = new Set([song.album!, ...song.otherAlbums])
      const near = pool.albums
        .filter((a) => !forbidden.has(a.title) && Math.abs(a.year - song.year!) <= 8)
        .map((a) => a.title)
      const built = choicesFrom(rng, song.album!, near)
      if (!built) return null
      used.add(song.id)
      return {
        id: `audioalbum:${song.id}`,
        kind: 'audio-album',
        prompt: 'מאיזה אלבום הקטע הזה?',
        hint: 'תקשיבו ותזהו',
        ...built,
        difficulty: song.difficulty,
        audioClip: song.audioClip,
        clipSeconds: clipLengthFor(song.difficulty),
        reveal: `זה "${song.title}" מהאלבום "${song.album}" (${song.year}).`,
      }
    },
  },
  {
    // באיזו שנה יצא הקטע
    kind: 'audio-year',
    weight: 3,
      supply: (p) => p.audioAny.length,
    ready: (p) => p.audioAny.length >= 4 && p.years.length >= 4,
    make(rng, pool, used) {
      const candidates = pool.audioAny.filter((s) => s.year && !used.has(s.id))
      if (!candidates.length) return null
      const song = pick(rng, candidates)
      const near = pool.years.filter((y) => y !== song.year && Math.abs(y - song.year!) <= 7)
      const built = choicesFrom(rng, yearLabel(song.year!), near.map(yearLabel))
      if (!built) return null
      used.add(song.id)
      return {
        id: `audioyear:${song.id}`,
        kind: 'audio-year',
        prompt: 'באיזו שנה יצא השיר שמתנגן?',
        ...built,
        difficulty: song.difficulty,
        audioClip: song.audioClip,
        clipSeconds: clipLengthFor(song.difficulty),
        reveal: `זה "${song.title}" משנת ${song.year}, מהאלבום "${song.album}".`,
      }
    },
  },
  {
    // מאיזה שיר השורה, בהקלדה
    kind: 'lyric-open',
    weight: 3,
      supply: (p) => p.withLyrics.length,
    ready: (p) => p.withLyrics.length >= 1,
    make(rng, pool, used) {
      const candidates = pool.withLyrics.filter((s) => !used.has(s.id))
      if (!candidates.length) return null
      const song = pick(rng, candidates)
      used.add(song.id)
      return {
        id: `lyricopen:${song.id}`,
        kind: 'lyric-open',
        prompt: 'מאיזה שיר השורה הזאת?',
        quote: song.lyricLine,
        hint: 'תקליטו את שם השיר',
        choices: [],
        answerIndex: -1,
        accepted: acceptedAnswers(song.title),
        correctLabel: song.title,
        difficulty: song.difficulty,
        timeLimitMs: OPEN_QUESTION_TIME_MS,
        reveal: `השורה היא מ"${song.title}" (${song.year}).`,
      }
    },
  },
  {
    // איזה אלבום יצא קודם
    kind: 'album-order',
    weight: 2,
      supply: (p) => p.albums.length * 2,
    ready: (p) => p.albums.length >= 6,
    make(rng, pool, used) {
      const a = pick(rng, pool.albums)
      const far = pool.albums.filter((x) => Math.abs(x.year - a.year) >= 4 && x.title !== a.title)
      if (!far.length) return null
      const b = pick(rng, far)
      const key = `albumorder:${[a.title, b.title].sort().join('|')}`
      if (used.has(key)) return null
      used.add(key)
      const [first, second] = a.year < b.year ? [a, b] : [b, a]
      const choices = shuffle(rng, [a.title, b.title])
      return {
        id: key,
        kind: 'album-order',
        prompt: 'איזה אלבום יצא קודם?',
        choices,
        answerIndex: choices.indexOf(first.title),
        difficulty: Math.abs(a.year - b.year) >= 10 ? 'easy' : 'medium',
        reveal: `"${first.title}" יצא ב-${first.year}, "${second.title}" ב-${second.year}.`,
      }
    },
  },
  {
    // עם מי אייל שר הכי הרבה
    kind: 'guest-count',
    weight: 1,
      supply: () => 1,
    ready: (p) => p.artists.length >= 4,
    make(rng, pool, used) {
      const key = 'guestcount'
      if (used.has(key)) return null
      const counts = new Map<string, number>()
      for (const song of pool.songs) {
        for (const guest of song.features) {
          if (pool.artists.includes(guest)) counts.set(guest, (counts.get(guest) ?? 0) + 1)
        }
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
      // צריך פער ברור בין המוביל לשאר, אחרת זו שאלה שאין לה תשובה אחת
      if (ranked.length < 4 || ranked[0][1] <= ranked[1][1]) return null
      const built = choicesFrom(rng, ranked[0][0], ranked.slice(1).map(([name]) => name))
      if (!built) return null
      used.add(key)
      return {
        id: key,
        kind: 'guest-count',
        prompt: 'עם מי אייל גולן שר הכי הרבה דואטים?',
        ...built,
        difficulty: 'medium',
        reveal: `${ranked[0][0]} — ${ranked[0][1]} שירים משותפים.`,
      }
    },
  },
  {
    // מאיזה שיר השורה — ארבע אפשרויות
    kind: 'lyric',
    weight: 2,
      supply: (p) => p.withLyrics.length,
    ready: (p) => p.withLyrics.length >= 4,
    make(rng, pool, used) {
      const withLyrics = pool.withLyrics.filter((s) => !used.has(s.id))
      if (!withLyrics.length) return null
      const song = pick(rng, withLyrics)
      const built = choicesFrom(rng, song.title, pool.songs.map((s) => s.title))
      if (!built) return null
      used.add(song.id)
      return {
        id: `lyric:${song.id}`,
        kind: 'lyric',
        prompt: 'מאיזה שיר השורה הזאת?',
        quote: song.lyricLine,
        ...built,
        difficulty: song.difficulty,
        reveal: `השורה היא מ"${song.title}" (${song.year}).`,
      }
    },
  },
  {
    // מה השורה הבאה. הזוג נלקח ממקומות סמוכים במקור, אז זו באמת
    // השורה שבאה אחרי ולא ניחוש.
    kind: 'next-line',
    weight: 3,
      supply: (p) => p.withNextLine.length,
    ready: (p) => p.withNextLine.length >= 4,
    make(rng, pool, used) {
      const candidates = pool.withNextLine.filter((s) => !used.has(s.id))
      if (!candidates.length) return null
      const song = pick(rng, candidates)
      // המסיחים הם שורות אמיתיות משירים אחרים, כדי שכולן יישמעו סבירות
      const others = pool.withNextLine
        .filter((s) => s.id !== song.id)
        .map((s) => s.nextLine!.next)
      const built = choicesFrom(rng, song.nextLine!.next, others)
      if (!built) return null
      used.add(song.id)
      return {
        id: `nextline:${song.id}`,
        kind: 'next-line',
        prompt: 'מה השורה הבאה?',
        quote: song.nextLine!.line,
        ...built,
        difficulty: song.difficulty,
        reveal: `מתוך "${song.title}" (${song.year}).`,
      }
    },
  },
  {
    // איזו מילה חסרה בשורה
    kind: 'fill-gap',
    weight: 3,
      supply: (p) => p.withGap.length,
    ready: (p) => p.withGap.length >= 4 && p.gapWords.length >= 6,
    make(rng, pool, used) {
      const candidates = pool.withGap.filter((s) => !used.has(s.id))
      if (!candidates.length) return null
      const song = pick(rng, candidates)
      const built = choicesFrom(rng, song.gap!.word, pool.gapWords)
      if (!built) return null
      used.add(song.id)
      return {
        id: `gap:${song.id}`,
        kind: 'fill-gap',
        prompt: 'איזו מילה חסרה?',
        quote: song.gap!.line,
        ...built,
        difficulty: song.difficulty,
        reveal: `"${song.gap!.line.replace('＿＿＿', song.gap!.word)}" — מתוך "${song.title}".`,
      }
    },
  },
  {
    // איזה מהארבעה הכי ותיק
    kind: 'oldest',
    weight: 2,
      supply: (p) => p.dated.length,
    ready: (p) => p.dated.length >= 20,
    make(rng, pool, used) {
      const four = sample(rng, pool.dated, 4)
      if (four.length < 4) return null
      const sorted = [...four].sort((a, b) => a.year! - b.year!)
      // צריך הבדל ברור בין הראשון לשני, אחרת אין תשובה אחת נכונה
      if (sorted[0].year === sorted[1].year) return null
      const key = `oldest:${four.map((s) => s.id).sort().join('|')}`
      if (used.has(key)) return null
      used.add(key)
      const choices = shuffle(rng, four.map((s) => s.title))
      return {
        id: key,
        kind: 'oldest',
        prompt: 'איזה מהשירים האלה יצא ראשון?',
        choices,
        answerIndex: choices.indexOf(sorted[0].title),
        difficulty: sorted[1].year! - sorted[0].year! >= 8 ? 'medium' : 'hard',
        reveal: four
          .slice()
          .sort((a, b) => a.year! - b.year!)
          .map((s) => `${s.title} (${s.year})`)
          .join(' · '),
      }
    },
  },
  {
    // איזה מהארבעה הכי ארוך
    kind: 'longest',
    weight: 1,
      supply: (p) => p.songs.filter((s) => s.lengthMs).length,
    ready: (p) => p.songs.filter((s) => s.lengthMs).length >= 20,
    make(rng, pool, used) {
      // מעל שמונה דקות זו כמעט תמיד מחרוזת או גרסת הופעה, ואז
      // השאלה הופכת לטריוויאלית
      const timed = pool.songs.filter((s) => s.lengthMs && s.lengthMs <= 8 * 60_000)
      const four = sample(rng, timed, 4)
      if (four.length < 4) return null
      const sorted = [...four].sort((a, b) => b.lengthMs! - a.lengthMs!)
      // פער של חצי דקה לפחות, אחרת זה ניחוש
      if (sorted[0].lengthMs! - sorted[1].lengthMs! < 30_000) return null
      const key = `longest:${four.map((s) => s.id).sort().join('|')}`
      if (used.has(key)) return null
      used.add(key)
      const choices = shuffle(rng, four.map((s) => s.title))
      const mins = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`
      return {
        id: key,
        kind: 'longest',
        prompt: 'איזה מהשירים האלה הכי ארוך?',
        choices,
        answerIndex: choices.indexOf(sorted[0].title),
        difficulty: 'hard',
        reveal: sorted.map((s) => `${s.title} ${mins(s.lengthMs!)}`).join(' · '),
      }
    },
  },
  {
    // שיר אמיתי או שם מומצא. השם המזויף מורכב משברי שמות אמיתיים,
    // אז הוא נשמע לגמרי סביר — וזה מה שהופך את זה לקשה.
    kind: 'real-or-fake',
    weight: 2,
      supply: (p) => p.dated.length,
    ready: (p) => p.dated.length >= 30,
    make(rng, pool, used) {
      const real = pick(rng, pool.dated)
      const fake = inventTitle(rng, pool)
      if (!fake) return null
      const askAboutReal = rng() < 0.5
      const subject = askAboutReal ? real.title : fake
      const key = `realfake:${subject}`
      if (used.has(key)) return null
      used.add(key)
      const choices = ['שיר אמיתי', 'לא קיים']
      return {
        id: key,
        kind: 'real-or-fake',
        prompt: 'יש לאייל גולן שיר בשם הזה?',
        quote: subject,
        choices,
        answerIndex: askAboutReal ? 0 : 1,
        difficulty: 'medium',
        reveal: askAboutReal
          ? `"${real.title}" אמיתי לגמרי — מהאלבום "${real.album}" (${real.year}).`
          : `לא קיים. המצאנו אותו משברי שמות של שירים אחרים.`,
      }
    },
  },
]

/**
 * ממציא שם שיר שנשמע אמיתי, מצירוף שברים של שמות קיימים.
 * "לב של גבר" ועוד "חייל של אהבה" נותנים "לב של אהבה" — שם שאף אחד
 * לא בטוח לגביו, וזה בדיוק העניין.
 */
function inventTitle(rng: Rng, pool: Pool): string | null {
  const existing = new Set(pool.songs.map((s) => s.title.trim()))
  // רק שמות עבריים נקיים: שם עם סוגריים או אנגלית נראה כמו תקלה,
  // לא כמו שיר, והשחקן פוסל אותו בלי לחשוב
  const clean = (t: string) => /^[א-ת\s'״׳,!?-]+$/.test(t) && !/[()\[\]&]/.test(t)
  const source = pool.dated.filter((s) => clean(s.title))
  if (source.length < 10) return null

  for (let attempt = 0; attempt < 30; attempt++) {
    const a = pick(rng, source).title.split(/\s+/)
    const b = pick(rng, source).title.split(/\s+/)
    if (a.length < 2 || b.length < 2) continue

    // חצי מהראשון וחצי מהשני
    const head = a.slice(0, Math.max(1, Math.ceil(a.length / 2)))
    const tail = b.slice(Math.floor(b.length / 2))
    const candidate = [...head, ...tail].join(' ').trim()

    if (candidate.split(/\s+/).length < 2 || candidate.length > 30) continue
    if (!clean(candidate)) continue
    if (existing.has(candidate)) continue
    // לא מקבלים שם שהוא בעצם אחד המקוריים
    if (candidate === a.join(' ') || candidate === b.join(' ')) continue
    return candidate
  }
  return null
}

function pickUnused(rng: Rng, songs: Song[], used: Set<string>): Song | null {
  const free = songs.filter((s) => !used.has(s.id))
  if (!free.length) return null
  const chosen = pick(rng, free)
  used.add(chosen.id)
  return chosen
}

/**
 * מייצר חידון שלם. אותו seed מחזיר בדיוק את אותן שאלות באותו סדר —
 * זה מה שמאפשר לעשרה טלפונים לשחק את אותו משחק בלי שהשאלות יעברו ברשת.
 */
export function generateQuiz(allSongs: Song[], config: QuizConfig): Question[] {
  const rng = createRng(config.seed)
  const pool = buildPool(allSongs, config)

  let available = GENERATORS.filter((g) => (!config.kinds || config.kinds.includes(g.kind)) && g.ready(pool))
  if (!available.length) return []

  const used = new Set<string>()
  const questions: Question[] = []
  const seenIds = new Set<string>()
  const themeCount = new Map<string, number>()

  // תקרת נושא: כמה שאלות מאותו נושא מותר בחידון הזה.
  // לפחות אחת, אחרת חידון קצר לא יוכל לייצר כלום.
  const themeCap = Math.max(1, Math.floor(config.questionCount * MAX_THEME_SHARE))
  const themesAvailable = new Set(available.map((g) => THEME_OF[g.kind])).size

  // תקרת ניסיונות כדי שמאגר דליל לא ייתקע בלולאה אינסופית
  let attempts = 0
  const maxAttempts = config.questionCount * 25

  while (questions.length < config.questionCount && attempts < maxAttempts) {
    attempts++

    // כשנשאר נושא אחד אין טעם באיזון, אחרת נתקע בלי למלא את החידון
    const capped =
      themesAvailable > 1
        ? available.filter((g) => (themeCount.get(THEME_OF[g.kind]) ?? 0) < themeCap)
        : available
    const pickFrom = capped.length ? capped : available

    const generator = weightedPick(rng, pickFrom, pool)
    const question = generator.make(rng, pool, used)
    if (!question || seenIds.has(question.id)) continue

    seenIds.add(question.id)
    questions.push(question)
    const theme = THEME_OF[generator.kind]
    themeCount.set(theme, (themeCount.get(theme) ?? 0) + 1)
  }

  return questions
}

function weightedPick(rng: Rng, generators: Generator[], pool: Pool): Generator {
  const weights = generators.map((g) => effectiveWeight(g, pool))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return generators[generators.length - 1]
  let roll = rng() * total
  for (const [i, g] of generators.entries()) {
    roll -= weights[i]
    if (roll <= 0) return g
  }
  return generators[generators.length - 1]
}

/** כמה שאלות אפשר בכלל לייצר מהמאגר הנוכחי — למסך ההגדרות */
export function availableKinds(allSongs: Song[], config: QuizConfig): QuestionKind[] {
  const pool = buildPool(allSongs, config)
  return GENERATORS.filter((g) => g.ready(pool)).map((g) => g.kind)
}
