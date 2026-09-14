// בודק את הכתובת שחן באמת ייכנס אליה מהטלפון, כולל משחק עם שני שחקנים.
// השרת עצמו לא פותר MagicDNS, אז מפנים את הדפדפן ל-IP של ה-tailnet.
import { chromium } from 'playwright'

const HOST = process.env.QUIZ_HOST ?? 'integrating-microwave-conversation-resumes.trycloudflare.com'
// ריק = כתובת ציבורית שנפתרת ב-DNS רגיל
const TAILNET_IP = process.env.TAILNET_IP ?? ''
const URL = `https://${HOST}/`

const browser = await chromium.launch(
  TAILNET_IP ? { args: [`--host-resolver-rules=MAP ${HOST.split(':')[0]} ${TAILNET_IP}`] } : {},
)
const errors = []

async function phone(label) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'he-IL',
    // התעודה של Tailscale אמיתית (Let's Encrypt), אז לא עוקפים אימות
    ignoreHTTPSErrors: false,
  })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`))
  await page.goto(URL, { waitUntil: 'networkidle' })
  return page
}

const fail = (m) => {
  console.error('✗', m)
  process.exitCode = 1
}

// --- האתר נטען ---
const host = await phone('host')
const title = await host.locator('h1').first().textContent()
if (title?.trim() !== 'אייל גולן') fail(`הדף לא נטען (כותרת: ${title})`)
else console.log('✓ האתר נטען מהכתובת האמיתית')

// --- ה-service worker נרשם, אחרת אין אופליין ---
const swReady = await host
  .waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 15_000 })
  .then(() => true)
  .catch(() => false)
if (!swReady) fail('ה-service worker לא נרשם — האופליין לא יעבוד')
else console.log('✓ ה-service worker נרשם (אופליין יעבוד אחרי הטעינה הראשונה)')

// --- מולטיפלייר דרך WebSocket מאובטח ---
await host.evaluate(() => localStorage.setItem('eyal-quiz-nickname', 'חן'))
await host.reload({ waitUntil: 'networkidle' })
await host.getByRole('button', { name: 'לפתוח משחק לחברים' }).click()
await host.waitForTimeout(300)
await host.getByRole('button', { name: 'לפתוח חדר' }).click()
await host.waitForTimeout(1500)

const code = (await host.locator('.text-6xl').first().textContent())?.trim() ?? ''
if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) fail(`לא נפתח חדר (קוד: "${code}")`)
else console.log(`✓ WebSocket מאובטח עובד — נפתח חדר ${code}`)

const guest = await phone('guest')
await guest.getByRole('button', { name: 'להצטרף עם קוד' }).click()
await guest.locator('input').first().fill(code)
await guest.locator('input').nth(1).fill('דני')
await guest.getByRole('button', { name: 'יאללה, נכנסים' }).click()
await guest.waitForTimeout(1500)

const inRoom = await host.getByText('דני').count()
if (!inRoom) fail('השחקן השני לא הופיע בחדר')
else console.log('✓ שחקן שני הצטרף וגלוי אצל המארח')

await host.getByRole('button', { name: 'יאללה, מתחילים' }).click()
await host.waitForTimeout(1200)
const q = await host.locator('h2').first().textContent()
if (!q || q.length < 8) fail('המשחק לא התחיל')
else console.log(`✓ המשחק רץ: "${q.slice(0, 40)}..."`)

await host.locator('button:has(> span.grid)').first().click()
await guest.locator('button:has(> span.grid)').nth(1).click()
await host.waitForTimeout(2000)

// אחרי שכולם ענו נחשפת התשובה הנכונה (כפתור ירוק) וטבלת הסיבוב.
// לא בודקים ניקוד חיובי — הדפדפנים לוחצים אקראית ועלולים שניהם לטעות.
const correctShown = await host.locator('button.border-emerald-400\\/70').count()
const roundTable = await host.locator('ol li').count()
if (!correctShown) fail('התשובה הנכונה לא נחשפה')
else if (roundTable < 2) fail(`טבלת הסיבוב לא הציגה את שני השחקנים (${roundTable})`)
else console.log('✓ התשובה נחשפה וטבלת הסיבוב מציגה את שני השחקנים')

await host.screenshot({ path: '/tmp/shot-live.png' })
console.log('\nשגיאות בקונסול:', errors.length ? errors.join(' | ') : 'אין')
await browser.close()

if (!process.exitCode) console.log(`\nהכל עובד על ${URL}`)
