// מוכיח שהדרישה המרכזית מתקיימת: אחרי טעינה אחת, משחק לבד עובד
// בלי שום רשת. טוען את האפליקציה, מנתק את האינטרנט לגמרי, ומשחק.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })
const page = await ctx.newPage()

const fail = (msg) => {
  console.error('✗', msg)
  process.exitCode = 1
}

// טעינה ראשונה עם רשת — פה ה-service worker אוסף את כל התוכן
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 15_000 })
  .catch(() => fail('ה-service worker לא השתלט על הדף'))
await page.waitForTimeout(2500) // זמן ל-precache להשלים

// מנתקים את הרשת לגמרי
await ctx.setOffline(true)
console.log('הרשת נותקה')

await page.reload({ waitUntil: 'domcontentloaded' })
const title = await page.locator('h1').first().textContent()
if (title?.trim() !== 'אייל גולן') fail(`הדף לא נטען אופליין (כותרת: "${title}")`)
else console.log('✓ האפליקציה נטענה בלי רשת')

// האפשרויות שדורשות רשת צריכות להיות מושבתות
const hostBtn = page.getByRole('button', { name: 'לפתוח משחק לחברים' })
if (!(await hostBtn.isDisabled())) fail('כפתור המשחק עם חברים פעיל למרות שאין רשת')
else console.log('✓ משחק עם חברים מושבת כשאין רשת')

// ומשחק לבד חייב לעבוד מלא
await page.getByRole('button', { name: 'משחק לבד' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'יאללה, מתחילים' }).click()
await page.waitForTimeout(600)

const prompt = await page.locator('h2').first().textContent()
if (!prompt || prompt.length < 8) fail('לא נוצרה שאלה אופליין')
else console.log(`✓ נוצרה שאלה בלי רשת: "${prompt.slice(0, 45)}..."`)

const choices = page.locator('button:has(> span.grid)')
if ((await choices.count()) < 2) fail('אין אפשרויות תשובה')
await choices.first().click()
await page.waitForTimeout(400)

const reveal = await page.getByRole('button', { name: /לשאלה הבאה|לתוצאות/ }).count()
if (!reveal) fail('התשובה לא נרשמה אופליין')
else console.log('✓ אפשר לענות ולהתקדם בלי רשת')

await page.screenshot({ path: '/tmp/shot-offline.png' })
await browser.close()

if (!process.exitCode) console.log('\nמשחק לבד עובד לגמרי בלי אינטרנט.')
