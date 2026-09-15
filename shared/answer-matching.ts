// השוואת תשובה מוקלדת לשם שיר.
//
// בשאלה פתוחה השחקן מקליד תוך כדי שהשעון רץ, על מקלדת בטלפון, בעברית.
// אם נדרוש התאמה מדויקת כמעט כל תשובה נכונה תיפסל: "בלעדיך" מול "בלעדייך",
// "הלב על השולחן" מול "לב על השולחן", רווח כפול, גרש שהמקלדת הפכה לגרשיים.
// לכן משווים אחרי נרמול, ומרשים מרחק עריכה קטן שגדל עם אורך השם.

/** מוריד מהטקסט כל מה שלא משנה את זהות השיר */
export function normalizeAnswer(text: string): string {
  return (
    text
      .replace(/[֑-ׇ]/g, '') // ניקוד וטעמים
      .replace(/[‎‏‪-‮]/g, '') // תווי כיוון נסתרים
      .replace(/["'׳״''`´]/g, '') // גרשיים בכל הצורות שמקלדות מייצרות
      .replace(/[.,!?;:]/g, '')
      .replace(/[־–—/|_-]/g, ' ')
      // כתיב מלא מול חסר — ההבדל הכי נפוץ בעברית מוקלדת
      .replace(/יי/g, 'י')
      .replace(/וו/g, 'ו')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

/** מוריד תחיליות שמשנות ניסוח אבל לא זהות: "ה", "ו" */
function stripPrefix(text: string): string {
  return text.replace(/^(ה|ו)\s?/, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * כמה שגיאות מרשים. שם קצר כמו "זרה" לא יכול לסבול שגיאה אחת בלי
 * להפוך למילה אחרת, שם ארוך כמו "לילד הזה התפללתי" כן.
 */
function tolerance(length: number): number {
  if (length <= 4) return 0
  if (length <= 8) return 1
  if (length <= 14) return 2
  return 3
}

export interface MatchResult {
  correct: boolean
  /** התשובה הקבילה שהתאימה, לחשיפה אחרי התשובה */
  matched?: string
  /** התאמה שהתקבלה למרות שגיאות כתיב — מציגים את הכתיב הנכון */
  hadTypo?: boolean
}

/**
 * בודק אם מה שהשחקן הקליד מתאים לאחת התשובות הקבילות.
 * `accepted` הוא שם השיר ועוד וריאציות סבירות שלו.
 */
export function matchesAnswer(input: string, accepted: readonly string[]): MatchResult {
  const guess = normalizeAnswer(input)
  if (!guess) return { correct: false }

  const guessBare = stripPrefix(guess)

  for (const candidate of accepted) {
    const target = normalizeAnswer(candidate)
    if (!target) continue
    const targetBare = stripPrefix(target)

    if (guess === target || guessBare === targetBare) {
      return { correct: true, matched: candidate }
    }

    const limit = tolerance(Math.max(targetBare.length, guessBare.length))
    if (limit > 0 && levenshtein(guessBare, targetBare) <= limit) {
      return { correct: true, matched: candidate, hadTypo: true }
    }
  }

  return { correct: false }
}

/**
 * בונה את רשימת התשובות הקבילות לשיר.
 * מעבר לשם המלא מקבלים גם את החלק שלפני סוגריים, וגם ניסוח בלי
 * תחילית — שחקן שכותב "לב על השולחן" התכוון לשיר הנכון.
 */
export function acceptedAnswers(title: string): string[] {
  const answers = new Set<string>([title])

  const withoutParens = title.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').trim()
  if (withoutParens) answers.add(withoutParens)

  const bare = stripPrefix(normalizeAnswer(title))
  if (bare) answers.add(bare)

  return [...answers]
}
