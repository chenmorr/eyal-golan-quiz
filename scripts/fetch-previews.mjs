// מחבר לכל שיר קטע תצוגה מקדימה רשמי של אפל.
//
// למה דרך iTunes ולא קבצים אצלנו: ה-preview הוא שירות רשמי של אפל שנועד
// בדיוק לזה, הקישור מצביע ל-CDN שלהם ואנחנו לא מאחסנים שום אודיו מוגן.
// זה מה שמאפשר להדליק את שאלות הזיהוי בלי בעיית זכויות.
//
// שימו לב: ה-preview מתחיל מהקטע שאפל בחרה (בדרך כלל סביב הפזמון),
// לא משנייה הראשונה של השיר.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SONGS_PATH = join(ROOT, 'data', 'songs.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// חייב להתאים לנרמול ב-build-songs.mjs
function normalize(title) {
  return title
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/["'׳״''`]/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/\s+(19|20)\d{2}\s*$/, '')
    .replace(/[־–—/|_-]/g, ' ')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function itunes(params) {
  const q = new URLSearchParams({ ...params, entity: 'song', country: 'IL' })
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://itunes.apple.com/search?${q}`, {
      headers: { 'User-Agent': 'EyalGolanQuiz/1.0' },
    })
    if (res.ok) return res.json()
    // iTunes מגביל קצב ומחזיר 403 כשדוחפים חזק מדי
    await sleep(attempt * 1500)
  }
  return { results: [] }
}

const songs = JSON.parse(await readFile(SONGS_PATH, 'utf8'))
const byKey = new Map(songs.map((s) => [normalize(s.title), s]))

// שולפים את כל הקטלוג של אייל גולן בכמה עמודים, ומתאימים לפי שם מנורמל.
// זה הרבה יותר יעיל מחיפוש נפרד לכל שיר, וגם נעים יותר ל-API.
const seen = new Map()
const TERMS = ['eyal golan', 'אייל גולן']

for (const term of TERMS) {
  for (const offset of [0, 200, 400, 600]) {
    const data = await itunes({ term, limit: '200', offset: String(offset) })
    if (!data.results?.length) break
    for (const r of data.results) {
      if (!r.previewUrl || !r.trackName) continue
      const key = normalize(r.trackName)
      // מעדיפים את ההקלטה הראשונה שנמצאה; האלבומים החוזרים מוסיפים רעש
      if (!seen.has(key)) seen.set(key, r.previewUrl)
    }
    console.log(`  "${term}" offset ${offset}: ${data.results.length} תוצאות, ${seen.size} ייחודיים`)
    await sleep(700)
  }
}

let matched = 0
for (const song of songs) {
  const url = seen.get(normalize(song.title))
  if (url) {
    song.audioClip = url
    matched++
  } else {
    delete song.audioClip
  }
}

await writeFile(SONGS_PATH, JSON.stringify(songs, null, 2))

console.log(`\nחיברתי קטעי אודיו ל-${matched} מתוך ${songs.length} שירים.`)
const byDiff = {}
for (const s of songs) {
  if (s.audioClip) byDiff[s.difficulty] = (byDiff[s.difficulty] ?? 0) + 1
}
console.log(`  לפי קושי: קל ${byDiff.easy ?? 0} | בינוני ${byDiff.medium ?? 0} | קשה ${byDiff.hard ?? 0}`)
if (matched < 4) console.log('  פחות מדי — שאלות הזיהוי לא יידלקו')
