// מחבר לטבלת השירים את התוכן שמגיע ידנית: קטעי אודיו ושורות מהשירים.
//
// למה זה נפרד מהאיסוף האוטומטי: הדיסקוגרפיה נמשכת מ-MusicBrainz בלחיצה,
// אבל אודיו ומילים הם חומר מוגן שאי אפשר למשוך. את זה מזינים ידנית,
// ומרגע שהוזן — שני סוגי שאלות נוספים נדלקים לבד בכל החידונים.
//
// שימוש:
//   1. שים קבצי אודיו ב-public/clips/ בשם של השיר, למשל: מי-שמאמין.mp3
//   2. הוסף שורות ל-data/lyrics.json בפורמט { "מי שמאמין": "השורה..." }
//   3. הרץ: npm run data:content

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SONGS_PATH = join(ROOT, 'data', 'songs.json')
const LYRICS_PATH = join(ROOT, 'data', 'lyrics.json')
const CLIPS_DIR = join(ROOT, 'public', 'clips')

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.wav'])

// חייב להתאים לנרמול ב-build-songs.mjs, אחרת שם קובץ לא ימצא את השיר
function normalize(name) {
  return name
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/["'׳״'']/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/\s+(19|20)\d{2}\s*$/, '')
    .replace(/[־–—/|_-]/g, ' ')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const songs = JSON.parse(await readFile(SONGS_PATH, 'utf8'))
const byKey = new Map(songs.map((s) => [normalize(s.title), s]))

// --- קטעי אודיו ---
let clipsAttached = 0
const orphanClips = []

if (existsSync(CLIPS_DIR)) {
  const files = await readdir(CLIPS_DIR)
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext)) continue

    const song = byKey.get(normalize(basename(file, ext)))
    if (song) {
      song.audioClip = `/clips/${file}`
      clipsAttached++
    } else {
      orphanClips.push(file)
    }
  }
}

// --- שורות מהשירים ---
let lyricsAttached = 0
const orphanLyrics = []

if (existsSync(LYRICS_PATH)) {
  const lyrics = JSON.parse(await readFile(LYRICS_PATH, 'utf8'))
  for (const [title, line] of Object.entries(lyrics)) {
    if (!line || typeof line !== 'string') continue
    const song = byKey.get(normalize(title))
    if (song) {
      song.lyricLine = line.trim()
      lyricsAttached++
    } else {
      orphanLyrics.push(title)
    }
  }
}

await writeFile(SONGS_PATH, JSON.stringify(songs, null, 2))

console.log(`חיברתי ${clipsAttached} קטעי אודיו ו-${lyricsAttached} שורות.`)
if (clipsAttached >= 4) console.log('  ✓ שאלות "נחש את השיר" נדלקו')
else if (clipsAttached) console.log(`  ○ צריך ${4 - clipsAttached} קטעים נוספים כדי להדליק שאלות אודיו`)
if (lyricsAttached >= 4) console.log('  ✓ שאלות "מאיפה השורה" נדלקו')
else if (lyricsAttached) console.log(`  ○ צריך ${4 - lyricsAttached} שורות נוספות כדי להדליק שאלות מילים`)

if (orphanClips.length) {
  console.log(`\nקבצי אודיו שלא מצאו שיר תואם (${orphanClips.length}):`)
  for (const f of orphanClips.slice(0, 10)) console.log('  ', f)
  console.log('  שם הקובץ צריך להיות שם השיר בדיוק, למשל: מי שמאמין.mp3')
}
if (orphanLyrics.length) {
  console.log(`\nשורות ששויכו לשיר שלא קיים (${orphanLyrics.length}):`)
  for (const t of orphanLyrics.slice(0, 10)) console.log('  ', t)
}
