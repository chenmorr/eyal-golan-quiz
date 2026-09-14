// הופך את הדאטה הגולמי מ-MusicBrainz לטבלת שירים אחת נקייה.
// זו הטבלה שכל החידון נבנה מעליה — מוסיפים שיר, מקבלים שאלות חדשות בחינם.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data', 'raw')

const ARTIST_MBID = '1bac0f84-77e7-4884-a9ae-122a90582da0'

const releases = JSON.parse(await readFile(join(RAW, 'releases.json'), 'utf8'))

// מנקה שם שיר לצורך זיהוי כפילויות: אותו שיר בשתי גרסאות הוא עדיין אותו שיר
function normalizeTitle(title) {
  return title
    .replace(/[‎‏‪-‮]/g, '') // תווי כיוון RTL נסתרים
    .replace(/["'׳״'']/g, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ') // (לייב), (רמיקס), (feat...)
    .replace(/\s+(19|20)\d{2}\s*$/, '') // "בין הטוב והרע 2026" = אותו שיר מ-2001
    .replace(/[־–—/|-]/g, ' ')
    .replace(/יי/g, 'י') // כתיב מלא מול חסר: "בלעדייך" ו"בלעדיך" הם אותו שיר
    .replace(/וו/g, 'ו')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// MusicBrainz שומר שמות אמנים בכתיב המקורי שלהם. בחידון עברי שם ביוונית
// נראה כמו תקלה, אז מתעתקים את הבודדים שמופיעים בפועל.
const ARTIST_TRANSLITERATIONS = {
  'Νίκος Βέρτης': 'ניקוס ורטיס',
  'Mike Anthony': 'מייק אנתוני',
  'Duke Ellington': 'דיוק אלינגטון',
  'Ralph Stanley': 'ראלף סטנלי',
  Vivo: 'ויוו',
}
const transliterate = (name) => ARTIST_TRANSLITERATIONS[name] ?? name

// כותרות שאין להן מקום בחידון עברי.
// שימו לב שאין פה \b: גבול-מילה ב-JS מבוסס על [A-Za-z0-9_] בלבד,
// אז מול טקסט עברי הוא לא תופס כלום ו"מחרוזת: עינייך" הייתה מחליקה פנימה.
function isJunkTitle(title) {
  if (!/[א-ת]/.test(title)) return true // תעתיק לטיני של שיר שכבר קיים בעברית
  if (/^\s*(מיני[- ])?מחרוזת/.test(title)) return true // מחרוזות הופעה, לא שירים
  if (/(אינסטרומנטלי|קריוקי|פלייבק|ללא מילים|מדליי)/.test(title)) return true
  return false
}

// שנה מתוך תאריך חלקי: "2013-03-18" או "1997"
function yearOf(date) {
  if (!date) return null
  const y = parseInt(String(date).slice(0, 4), 10)
  return Number.isFinite(y) && y > 1980 && y < 2100 ? y : null
}

const songs = new Map()

for (const release of releases) {
  const rg = release['release-group'] ?? {}
  const secondary = rg['secondary-types'] ?? []
  const isLive = secondary.includes('Live')
  const isCompilation = secondary.includes('Compilation')
  const isStudio = !isLive && !isCompilation
  const releaseYear = yearOf(rg['first-release-date'] || release.date)
  const albumTitle = (rg.title || release.title || '').trim()

  for (const medium of release.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const title = (track.title || track.recording?.title || '').trim()
      if (!title || isJunkTitle(title)) continue

      const key = normalizeTitle(title)
      if (!key) continue

      // שיתופי פעולה: כל אמן בקרדיט שהוא לא אייל גולן
      const credits = track.recording?.['artist-credit'] ?? track['artist-credit'] ?? []
      const features = credits
        .map((c) => c.artist)
        .filter((a) => a && a.id !== ARTIST_MBID)
        .map((a) => transliterate(a.name.trim()))

      let song = songs.get(key)
      if (!song) {
        song = {
          key,
          title,
          year: null,
          album: null,
          albums: new Set(),
          features: new Set(),
          liveOnly: true,
          appearances: 0,
          lengthMs: null,
        }
        songs.set(key, song)
      }

      song.appearances++
      for (const f of features) song.features.add(f)
      if (albumTitle) song.albums.add(albumTitle)

      const len = track.length ?? track.recording?.length ?? null
      if (len && (!song.lengthMs || len > song.lengthMs)) song.lengthMs = len

      // השנה והאלבום הקנוניים נקבעים לפי ההופעה הראשונה בסטודיו
      if (isStudio) {
        song.liveOnly = false
        if (releaseYear && (song.year === null || releaseYear < song.year)) {
          song.year = releaseYear
          song.album = albumTitle
          song.title = title // הכותרת מהאלבום המקורי, לא מאוסף
        }
      } else if (song.liveOnly && releaseYear && (song.year === null || releaseYear < song.year)) {
        song.year = releaseYear
        song.album = albumTitle
      }
    }
  }
}

// כמה פעמים שיר חוזר באלבומים ואוספים הוא הפרוקסי הכי טוב שיש לנו לפופולריות:
// להיט אמיתי נדחס לכל אוסף, שיר צדדי מופיע פעם אחת ונעלם.
//
// אבל הספירה הגולמית מוטה לטובת הישן — לשיר מ-2001 היו עשרים וחמש שנה להיכנס
// לאוספים, לשיר מ-2024 היו שנתיים. לכן מדרגים כל שיר מול בני דורו ולא מול הכל.
// זה אומדן, לא נתוני האזנה אמיתיים.
const ERAS = [
  { name: 'שנות התשעים', from: 1990, to: 1999 },
  { name: 'שנות האלפיים', from: 2000, to: 2009 },
  { name: 'העשור הקודם', from: 2010, to: 2019 },
  { name: 'השנים האחרונות', from: 2020, to: 2100 },
]
const eraOf = (year) => ERAS.find((e) => year >= e.from && year <= e.to) ?? ERAS[ERAS.length - 1]

const rawTable = [...songs.values()]
  .map((s) => ({
    id: s.key.replace(/\s+/g, '-'),
    title: s.title,
    year: s.year,
    album: s.album,
    features: [...s.features],
    liveOnly: s.liveOnly,
    otherAlbums: [...s.albums].filter((a) => a !== s.album),
    lengthMs: s.lengthMs,
    appearances: s.appearances,
    era: s.year ? eraOf(s.year).name : null,
    isTitleTrack: !!s.album && normalizeTitle(s.album) === s.key,
  }))
  .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, 'he'))

// דירוג יחסי בתוך כל תקופה: השליש העליון קל, האמצעי בינוני, התחתון קשה.
// שיר ראשי של אלבום עולה דרגה — אלה השירים שנתנו לאלבום את שמו.
for (const era of ERAS) {
  const inEra = rawTable.filter((s) => s.era === era.name).sort((a, b) => b.appearances - a.appearances)
  inEra.forEach((song, i) => {
    const pct = i / Math.max(inEra.length - 1, 1)
    song.difficulty = pct <= 0.2 ? 'easy' : pct <= 0.55 ? 'medium' : 'hard'
    if (song.isTitleTrack && song.difficulty === 'hard') song.difficulty = 'medium'
    if (song.isTitleTrack && song.difficulty === 'medium') song.difficulty = 'easy'
  })
}
for (const s of rawTable) s.difficulty ??= 'hard'

const table = rawTable

await writeFile(join(ROOT, 'data', 'songs.json'), JSON.stringify(table, null, 2))

const withYear = table.filter((s) => s.year)
const studio = table.filter((s) => !s.liveOnly)
const withFeatures = table.filter((s) => s.features.length)

console.log(`סה"כ שירים ייחודיים: ${table.length}`)
console.log(`  עם שנה: ${withYear.length}`)
console.log(`  שירי סטודיו: ${studio.length}`)
console.log(`  עם שיתוף פעולה: ${withFeatures.length}`)
console.log(`  טווח שנים: ${Math.min(...withYear.map((s) => s.year))}–${Math.max(...withYear.map((s) => s.year))}`)
const byDifficulty = table.reduce((acc, s) => ({ ...acc, [s.difficulty]: (acc[s.difficulty] ?? 0) + 1 }), {})
console.log(`  קושי: קל ${byDifficulty.easy ?? 0} | בינוני ${byDifficulty.medium ?? 0} | קשה ${byDifficulty.hard ?? 0}`)
console.log('\nהכי מושמעים (מופיעים בהכי הרבה אלבומים ואוספים):')
for (const s of [...table].sort((a, b) => b.appearances - a.appearances).slice(0, 15)) {
  console.log(`  ${s.appearances}x  ${s.year ?? '????'}  ${s.title}  [${s.album ?? '-'}]`)
}
