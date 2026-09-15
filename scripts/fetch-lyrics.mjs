// מושך מילים מ-lrclib ומסמן שני דברים על כל שיר:
//
// 1. titleInLyrics — האם שם השיר מופיע במילים. אם כן, סביר מאוד שהוא
//    נשמע בקטע (הקטע של אפל מתחיל סביב הפזמון, ושם שרים את השם),
//    ואז שאלת "נחש את השיר" מסגירה את עצמה. שיר כזה עובר לשאלות
//    אחרות על אותו קטע: מאיזה אלבום, באיזו שנה.
//
// 2. lyricLine — שורה מהשיר לשאלת "מאיזה שיר השורה". נבחרת שורה
//    שלא מכילה את שם השיר, אחרת גם היא מסגירה את התשובה.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SONGS_PATH = join(ROOT, 'data', 'songs.json')
const CACHE_PATH = join(ROOT, 'data', 'raw', 'lyrics-cache.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function normalize(text) {
  return text
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'׳״''`]/g, '')
    .replace(/[־–—/|_-]/g, ' ')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function search(params) {
  const q = new URLSearchParams(params)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://lrclib.net/api/search?${q}`, {
        headers: { 'User-Agent': 'EyalGolanQuiz/1.0 (https://github.com/chenmorr/eyal-golan-quiz)' },
      })
      if (res.ok) return res.json()
      if (res.status === 404) return []
      // 503 = השרת עמוס, שווה להמתין
      await sleep(attempt * 1500)
    } catch {
      await sleep(attempt * 1000)
    }
  }
  return []
}

const songs = JSON.parse(await readFile(SONGS_PATH, 'utf8'))
const cache = JSON.parse(await readFile(CACHE_PATH, 'utf8').catch(() => '{}'))

// מתמקדים בשירים עם אודיו — שם הבעיה של שמיעת השם מתעוררת
const targets = songs.filter((s) => s.audioClip)
console.log(`מחפש מילים ל-${targets.length} שירים עם אודיו...`)

let found = 0
let fromCache = 0

for (const [i, song] of targets.entries()) {
  if (cache[song.id] !== undefined) {
    fromCache++
    continue
  }

  const results = await search({ artist_name: 'אייל גולן', track_name: song.title })
  const alt = results.length ? results : await search({ q: `אייל גולן ${song.title}` })

  // מקבלים רק התאמה של ממש בשם, אחרת נדביק מילים של שיר אחר
  const wanted = normalize(song.title)
  const hit = alt.find((r) => {
    const t = normalize(r.trackName ?? '')
    return t === wanted || t.includes(wanted) || wanted.includes(t)
  })

  cache[song.id] = hit?.plainLyrics ? { lyrics: hit.plainLyrics, track: hit.trackName } : null
  if (cache[song.id]) found++

  if ((i + 1) % 25 === 0) {
    console.log(`  ${i + 1}/${targets.length} — נמצאו ${found}`)
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2))
  }
  await sleep(350)
}

await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2))
console.log(`נמצאו מילים ל-${found} שירים (${fromCache} כבר היו במטמון)`)

// --- מחברים לטבלה ---
let flagged = 0
let withLine = 0

for (const song of songs) {
  const entry = cache[song.id]
  if (!entry?.lyrics) {
    // בלי מילים אי אפשר לדעת; מניחים שהשם כן נשמע, כדי לא להסגיר תשובות
    song.titleInLyrics = song.audioClip ? true : undefined
    continue
  }

  const lyrics = entry.lyrics
  const title = normalize(song.title)
  const lines = lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && l.length <= 60 && /[א-ת]/.test(l))

  const titleAppears = lines.some((l) => normalize(l).includes(title))
  song.titleInLyrics = titleAppears
  if (titleAppears) flagged++

  // שורה לשאלת המילים: לא כזו שמכילה את שם השיר
  const clean = lines.filter((l) => !normalize(l).includes(title))
  if (clean.length) {
    // השורה הרביעית ומעלה, כדי לא לקחת תמיד את הפתיחה
    song.lyricLine = clean[Math.min(3, clean.length - 1)]
    withLine++
  }
}

await writeFile(SONGS_PATH, JSON.stringify(songs, null, 2))

const audioSongs = songs.filter((s) => s.audioClip)
const safe = audioSongs.filter((s) => s.titleInLyrics === false)
console.log(`\nמתוך ${audioSongs.length} שירים עם אודיו:`)
console.log(`  ${safe.length} בטוחים ל"נחש את השיר" (השם לא מופיע במילים)`)
console.log(`  ${audioSongs.length - safe.length} שרים את שמם — יעברו לשאלות אחרות על הקטע`)
console.log(`  ${withLine} שירים קיבלו שורה לשאלות "מאיפה השורה"`)
