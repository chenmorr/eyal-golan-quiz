// מחלץ מהמילים השמורות את החומר לשאלות החדשות.
//
// מה נבנה מכאן:
//   coupled  — זוגות שורות רצופות, לשאלת "מה השורה הבאה"
//   gapLine  — שורה עם מילה אחת שהוחסרה, והמילה עצמה
//
// שתי השאלות האלה עובדות רק אם השורות באמת רצופות בשיר ואם המילה
// החסרה מספיק ייחודית. הסקריפט מסנן את מה שלא עומד בזה.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SONGS_PATH = join(ROOT, 'data', 'songs.json')
const CACHE_PATH = join(ROOT, 'data', 'raw', 'lyrics-cache.json')

const normalize = (t) =>
  t
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'׳״''`]/g, '')
    .replace(/[־–—/|_-]/g, ' ')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** מילים נפוצות מדי מכדי שיהיה מעניין להשלים אותן */
const STOPWORDS = new Set([
  'את', 'אני', 'לא', 'של', 'על', 'הוא', 'היא', 'זה', 'כל', 'אם', 'גם', 'רק',
  'מה', 'מי', 'כמו', 'יש', 'אין', 'לי', 'לך', 'לו', 'לה', 'בך', 'בי', 'עם',
  'אבל', 'כי', 'אז', 'הכל', 'שלי', 'שלך', 'הזה', 'הזאת', 'עוד', 'כבר', 'ולא',
])

const songs = JSON.parse(await readFile(SONGS_PATH, 'utf8'))
const cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'))

let coupled = 0
let gapped = 0

for (const song of songs) {
  const entry = cache[song.id]
  delete song.nextLine
  delete song.gap

  if (!entry?.lyrics) continue

  const title = normalize(song.title)
  // שורה שימושית: לא קצרה מדי, לא ארוכה מדי, ולא מסגירה את שם השיר
  const lines = entry.lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 14 && l.length <= 52 && /[א-ת]/.test(l))
    .filter((l) => !normalize(l).includes(title))

  // --- זוג שורות רצופות ---
  // חייבות להיות סמוכות במקור, אחרת "השורה הבאה" היא שקר
  const raw = entry.lyrics.split('\n').map((l) => l.trim())
  const pairs = []
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i]
    const b = raw[i + 1]
    if (!lines.includes(a) || !lines.includes(b)) continue
    if (normalize(a) === normalize(b)) continue // שורה שחוזרת על עצמה
    pairs.push([a, b])
  }
  if (pairs.length) {
    // לוקחים זוג מאמצע השיר, לא את הפתיחה שכולם מכירים
    const chosen = pairs[Math.floor(pairs.length / 2)]
    song.nextLine = { line: chosen[0], next: chosen[1] }
    coupled++
  }

  // --- שורה עם מילה חסרה ---
  const candidates = []
  for (const line of lines) {
    const words = line.split(/\s+/)
    if (words.length < 4) continue
    for (const [idx, w] of words.entries()) {
      const clean = w.replace(/[^א-ת]/g, '')
      // מילה מספיק ארוכה, לא מילת קישור, ולא חוזרת בשורה עצמה
      if (clean.length < 4 || STOPWORDS.has(clean)) continue
      if (words.filter((x) => x.replace(/[^א-ת]/g, '') === clean).length > 1) continue
      candidates.push({ line, idx, word: clean, words })
    }
  }
  if (candidates.length) {
    const pickIdx = Math.floor(candidates.length / 3)
    const c = candidates[pickIdx]
    song.gap = {
      line: c.words.map((w, i) => (i === c.idx ? '＿＿＿' : w)).join(' '),
      word: c.word,
    }
    gapped++
  }
}

await writeFile(SONGS_PATH, JSON.stringify(songs, null, 2))
console.log(`${coupled} שירים עם זוג שורות רצופות ("מה השורה הבאה")`)
console.log(`${gapped} שירים עם שורה חסרת מילה ("השלימו את המילה")`)

// אוצר המילים לשאלות ההשלמה — המסיחים נשאבים מכאן
const vocab = [...new Set(songs.filter((s) => s.gap).map((s) => s.gap.word))]
console.log(`${vocab.length} מילים ייחודיות למסיחים`)
