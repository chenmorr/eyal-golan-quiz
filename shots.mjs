// מריץ את האפליקציה בדפדפן אמיתי ומצלם. שני דפדפנים משחקים יחד בחדר אחד,
// כדי לראות שהמולטיפלייר באמת עובד ולא רק שהטסטים ירוקים.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = '/tmp'

const browser = await chromium.launch()
const errors = []

async function phone(label) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'he-IL',
  })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  return page
}

// --- משחק לבד ---
const solo = await phone('solo')
await solo.screenshot({ path: `${OUT}/shot-home.png` })

await solo.getByRole('button', { name: 'משחק לבד' }).click()
await solo.waitForTimeout(300)
await solo.screenshot({ path: `${OUT}/shot-setup.png` })

await solo.getByRole('button', { name: 'יאללה, מתחילים' }).click()
await solo.waitForTimeout(500)
await solo.screenshot({ path: `${OUT}/shot-question.png` })

const choices = solo.locator('button:has(> span.grid)')
await choices.first().click()
await solo.waitForTimeout(400)
await solo.screenshot({ path: `${OUT}/shot-answered.png` })

// רצים עד הסוף כדי לראות את מסך התוצאות
for (let i = 0; i < 12; i++) {
  const next = solo.getByRole('button', { name: /לשאלה הבאה|לתוצאות/ })
  if (!(await next.count())) break
  await next.click()
  await solo.waitForTimeout(250)
  const c = solo.locator('button:has(> span.grid)')
  if (await c.count()) await c.nth(i % 4).click()
  await solo.waitForTimeout(250)
}
await solo.waitForTimeout(400)
await solo.screenshot({ path: `${OUT}/shot-results.png` })

// --- משחק עם חברים: שני טלפונים בחדר אחד ---
const host = await phone('host')
await host.evaluate(() => localStorage.setItem('eyal-quiz-nickname', 'חן'))
await host.reload({ waitUntil: 'networkidle' })
await host.getByRole('button', { name: 'לפתוח משחק לחברים' }).click()
await host.waitForTimeout(300)
await host.getByRole('button', { name: 'לפתוח חדר' }).click()
await host.waitForTimeout(900)

const code = (await host.locator('.text-6xl').first().textContent())?.trim() ?? ''
console.log('קוד החדר שנפתח:', code)

const guest = await phone('guest')
await guest.getByRole('button', { name: 'להצטרף עם קוד' }).click()
await guest.locator('input').first().fill(code)
await guest.locator('input').nth(1).fill('דני')
await guest.getByRole('button', { name: 'יאללה, נכנסים' }).click()
await guest.waitForTimeout(900)

await host.screenshot({ path: `${OUT}/shot-lobby-host.png` })
await guest.screenshot({ path: `${OUT}/shot-lobby-guest.png` })

await host.getByRole('button', { name: 'יאללה, מתחילים' }).click()
await host.waitForTimeout(900)
await host.screenshot({ path: `${OUT}/shot-multi-question.png` })

// שניהם עונים, המארח ראשון
await host.locator('button:has(> span.grid)').first().click()
await host.waitForTimeout(600)
await host.screenshot({ path: `${OUT}/shot-multi-waiting.png` })
await guest.locator('button:has(> span.grid)').nth(1).click()
await guest.waitForTimeout(1200)
await host.screenshot({ path: `${OUT}/shot-multi-reveal.png` })

console.log('שגיאות בקונסול:', errors.length ? errors.join(' | ') : 'אין')
await browser.close()
