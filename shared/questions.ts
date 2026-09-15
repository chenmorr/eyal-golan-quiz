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

  return {
    songs,
    dated,
    byAlbum,
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
}

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
    kind: 'audio-open',
    weight: 5,
    ready: (p) => p.songs.filter((s) => s.audioClip).length >= 1,
    make(rng, pool, used) {
      const withAudio = pool.songs.filter((s) => s.audioClip && !used.has(s.id))
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
    ready: (p) => p.songs.filter((s) => s.audioClip).length >= 4,
    make(rng, pool, used) {
      const withAudio = pool.songs.filter((s) => s.audioClip && !used.has(s.id))
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
    // מאיזה שיר השורה — נוצרת רק כשהוזנו שורות
    kind: 'lyric',
    weight: 3,
    ready: (p) => p.songs.filter((s) => s.lyricLine).length >= 4,
    make(rng, pool, used) {
      const withLyrics = pool.songs.filter((s) => s.lyricLine && !used.has(s.id))
      if (!withLyrics.length) return null
      const song = pick(rng, withLyrics)
      const built = choicesFrom(rng, song.title, pool.songs.map((s) => s.title))
      if (!built) return null
      used.add(song.id)
      return {
        id: `lyric:${song.id}`,
        kind: 'lyric',
        prompt: `מאיזה שיר השורה "${song.lyricLine}"?`,
        ...built,
        difficulty: song.difficulty,
        reveal: `השורה היא מ"${song.title}" (${song.year}).`,
      }
    },
  },
]

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

  // תקרת ניסיונות כדי שמאגר דליל לא ייתקע בלולאה אינסופית
  let attempts = 0
  const maxAttempts = config.questionCount * 25

  while (questions.length < config.questionCount && attempts < maxAttempts) {
    attempts++
    const generator = weightedPick(rng, available)
    const question = generator.make(rng, pool, used)
    if (!question || seenIds.has(question.id)) continue
    seenIds.add(question.id)
    questions.push(question)
  }

  return questions
}

function weightedPick(rng: Rng, generators: Generator[]): Generator {
  const total = generators.reduce((sum, g) => sum + g.weight, 0)
  let roll = rng() * total
  for (const g of generators) {
    roll -= g.weight
    if (roll <= 0) return g
  }
  return generators[generators.length - 1]
}

/** כמה שאלות אפשר בכלל לייצר מהמאגר הנוכחי — למסך ההגדרות */
export function availableKinds(allSongs: Song[], config: QuizConfig): QuestionKind[] {
  const pool = buildPool(allSongs, config)
  return GENERATORS.filter((g) => g.ready(pool)).map((g) => g.kind)
}
