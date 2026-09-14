// מושך את כל הדיסקוגרפיה של אייל גולן מ-MusicBrainz.
// MusicBrainz מגביל לבקשה אחת בשנייה, אז הסקריפט מחכה בין הבקשות.
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ARTIST_MBID = '1bac0f84-77e7-4884-a9ae-122a90582da0' // אייל גולן
const UA = 'EyalGolanQuiz/1.0 (https://github.com/chenmorr)'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data', 'raw')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mb(path) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (res.ok) return res.json()
    if (res.status === 503) {
      console.log(`  rate limited, מחכה ${attempt * 2}s...`)
      await sleep(attempt * 2000)
      continue
    }
    throw new Error(`${res.status} ${res.statusText} on ${path}`)
  }
  throw new Error(`נכשל אחרי 5 ניסיונות: ${path}`)
}

// שולף את כל העמודים של endpoint מסוג browse
async function browseAll(entity, params, countKey, listKey) {
  const out = []
  let offset = 0
  while (true) {
    const q = new URLSearchParams({ ...params, fmt: 'json', limit: '100', offset: String(offset) })
    const page = await mb(`${entity}?${q}`)
    const items = page[listKey] ?? []
    out.push(...items)
    const total = page[countKey] ?? items.length
    console.log(`  ${entity}: ${out.length}/${total}`)
    offset += items.length
    if (out.length >= total || items.length === 0) break
    await sleep(1100)
  }
  return out
}

await mkdir(RAW, { recursive: true })

console.log('מושך release-groups (אלבומים, סינגלים, EP)...')
const releaseGroups = await browseAll(
  'release-group',
  { artist: ARTIST_MBID },
  'release-group-count',
  'release-groups',
)
await writeFile(join(RAW, 'release-groups.json'), JSON.stringify(releaseGroups, null, 2))
await sleep(1100)

console.log('מושך releases עם רשימת השירים...')
const releases = await browseAll(
  'release',
  { artist: ARTIST_MBID, inc: 'recordings+artist-credits+release-groups+media' },
  'release-count',
  'releases',
)
await writeFile(join(RAW, 'releases.json'), JSON.stringify(releases, null, 2))

console.log(`\nסיימתי. ${releaseGroups.length} release-groups, ${releases.length} releases`)
const trackCount = releases.reduce(
  (n, r) => n + (r.media ?? []).reduce((m, med) => m + (med.tracks?.length ?? 0), 0),
  0,
)
console.log(`סה"כ ${trackCount} רשומות שירים (לפני ניקוי כפילויות)`)
