// מדפיס את הכתובת הציבורית הנוכחית של החידון.
// מנהרת trycloudflare מקבלת שם חדש בכל הפעלה, אז אחרי כל restart
// הכתובת משתנה — הסקריפט הזה חוסך חיטוט בלוג.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const log = await readFile(join(ROOT, 'tunnel.log'), 'utf8').catch(() => '')
const matches = [...log.matchAll(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/g)]
  .map((m) => m[0])
  .filter((u) => !u.startsWith('https://api.'))

const url = matches.at(-1)
if (!url) {
  console.log('אין מנהרה פעילה. הפעל: systemctl --user start eyal-quiz-tunnel')
  process.exit(1)
}

const health = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null)
console.log(url)
console.log(health?.ok ? `  פעיל — ${health.songs} שירים, ${health.rooms} חדרים פתוחים` : '  לא מגיב')
