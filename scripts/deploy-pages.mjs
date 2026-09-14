// פורס את האתר ל-GitHub Pages, שזו הכתובת הקבועה שנשמרת במסך הבית.
//
// לצד קבצי האתר נכתב server.json עם כתובת המנהרה הנוכחית. האפליקציה
// קוראת אותו כשהיא רצה מ-Pages, וככה המולטיפלייר ממשיך לעבוד גם אחרי
// שכתובת המנהרה התחלפה — בלי שהאייקון בטלפון ישבר.

import { execFileSync } from 'node:child_process'
import { readFile, writeFile, rm, mkdir, cp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const STAGE = join(ROOT, '.pages-stage')
const REPO = 'chenmorr/eyal-golan-quiz'
const BASE = '/eyal-golan-quiz/'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts })

/** כתובת המנהרה הנוכחית, מתוך הלוג של cloudflared */
async function currentTunnelHost() {
  const log = await readFile(join(ROOT, 'tunnel.log'), 'utf8').catch(() => '')
  const urls = [...log.matchAll(/https:\/\/([a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com)/g)]
    .map((m) => m[1])
    .filter((h) => !h.startsWith('api.'))
  return urls.at(-1) ?? null
}

const host = await currentTunnelHost()
if (!host) {
  console.error('לא מצאתי מנהרה פעילה. הפעל: systemctl --user start eyal-quiz-tunnel')
  process.exit(1)
}
console.log('שרת החדרים:', host)

// בונים עם הנתיב של Pages
console.log('בונה...')
run('npm', ['run', 'build'], { env: { ...process.env, VITE_BASE: BASE }, stdio: 'inherit' })

await rm(STAGE, { recursive: true, force: true })
await mkdir(STAGE, { recursive: true })
await cp(DIST, STAGE, { recursive: true })

await writeFile(join(STAGE, 'server.json'), JSON.stringify({ host }, null, 2))
// בלי הקובץ הזה GitHub מריץ Jekyll ומתעלם מקבצים שמתחילים בקו תחתון
await writeFile(join(STAGE, '.nojekyll'), '')
// Pages לא יודע על ניתוב צד-לקוח; 404 שמחזיר את האפליקציה פותר את זה
await cp(join(STAGE, 'index.html'), join(STAGE, '404.html'))

console.log('דוחף ל-gh-pages...')
run('git', ['init', '-q'], { cwd: STAGE })
run('git', ['checkout', '-qB', 'gh-pages'], { cwd: STAGE })
run('git', ['add', '-A'], { cwd: STAGE })
run(
  'git',
  ['-c', 'user.email=chen@kenthai.co.il', '-c', 'user.name=Chen Mor', 'commit', '-qm', `deploy ${host}`],
  { cwd: STAGE },
)
run('git', ['push', '-qf', `https://github.com/${REPO}.git`, 'gh-pages'], { cwd: STAGE })
await rm(STAGE, { recursive: true, force: true })

// חוזרים לבנייה של השרת עצמו, שמוגש מהשורש
run('npm', ['run', 'build'], { stdio: 'inherit' })

console.log(`\nהופץ. הכתובת הקבועה: https://chenmorr.github.io${BASE}`)
