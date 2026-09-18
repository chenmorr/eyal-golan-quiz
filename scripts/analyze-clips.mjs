// מודד את עוצמת הקול בקטעי האודיו.
//
// למה: התלונה "שמים הקלטה ולא שומעים כלום" יכולה לנבוע משתי סיבות
// שונות — קטע שמתחיל בשקט או ב-fade-in, או ניגון שנחסם בדפדפן.
// כאן בודקים את הראשונה, ובדרך מוצאים כמה שניות באמת צריך לדלג
// בתחילת כל קטע כדי שהשחקן ישמע מוזיקה ולא אוויר.

import { execFile } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SONGS_PATH = join(ROOT, 'data', 'songs.json')
const TMP = join(ROOT, '.clip-analysis')

const LIMIT = Number(process.env.LIMIT) || 0
const WRITE = process.env.WRITE === '1'

/** עוצמה ממוצעת בקטע זמן, ב-dB. ‎-91 פירושו שקט מוחלט. */
async function meanVolume(file, start, duration) {
  try {
    const { stderr } = await run('ffmpeg', [
      '-v', 'error',
      '-ss', String(start),
      '-t', String(duration),
      '-i', file,
      '-af', 'volumedetect',
      '-f', 'null', '-',
    ])
    const m = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)
    return m ? parseFloat(m[1]) : null
  } catch {
    return null
  }
}

const songs = JSON.parse(await readFile(SONGS_PATH, 'utf8'))
let targets = songs.filter((s) => s.audioClip)
if (LIMIT) targets = targets.filter((_, i) => i % Math.ceil(targets.length / LIMIT) === 0)

await mkdir(TMP, { recursive: true })
console.log(`בודק ${targets.length} קטעים...`)

// שקט אמיתי הוא סביב ‎-60dB ומטה; מוזיקה רגילה בסביבות ‎-20
const SILENT_DB = -45
let quietStart = 0
let allQuiet = 0
const report = []

for (const [i, song] of targets.entries()) {
  const file = join(TMP, `${i}.m4a`)
  try {
    const res = await fetch(song.audioClip)
    if (!res.ok) continue
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
  } catch {
    continue
  }

  const head = await meanVolume(file, 0, 2)
  const whole = await meanVolume(file, 0, 30)
  if (head === null || whole === null) continue

  // כמה שניות לדלג עד שיש קול של ממש
  let skip = 0
  if (head < SILENT_DB) {
    for (const t of [1, 2, 3, 4, 5, 6]) {
      const v = await meanVolume(file, t, 2)
      if (v !== null && v >= SILENT_DB) {
        skip = t
        break
      }
    }
  }

  if (head < SILENT_DB) quietStart++
  if (whole < SILENT_DB) allQuiet++
  if (head < SILENT_DB || whole < SILENT_DB) {
    report.push({ title: song.title, head, whole, skip })
  }
  if (WRITE && skip > 0) song.clipStart = skip

  await rm(file, { force: true })
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${targets.length}`)
}

await rm(TMP, { recursive: true, force: true })

console.log(`\nמתוך ${targets.length}:`)
console.log(`  ${quietStart} מתחילים בשקט (שתי השניות הראשונות מתחת ל-${SILENT_DB}dB)`)
console.log(`  ${allQuiet} שקטים לכל אורכם`)
if (report.length) {
  console.log('\nהבעייתיים:')
  for (const r of report.slice(0, 25)) {
    console.log(
      `  ${r.title.padEnd(26)} התחלה ${String(r.head).padStart(7)}dB  כולו ${String(r.whole).padStart(7)}dB` +
        (r.skip ? `  → לדלג ${r.skip}s` : '  → שקט לגמרי'),
    )
  }
}

if (WRITE) {
  await writeFile(SONGS_PATH, JSON.stringify(songs, null, 2))
  console.log('\nנקודות ההתחלה נשמרו ב-songs.json')
}
