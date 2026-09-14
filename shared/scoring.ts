// ניקוד בסגנון Kahoot: כל מי שצדק מקבל, ומי שהיה מהיר מקבל יותר.
//
// למה לא "הראשון לוקח הכל": בחדר של עשרה אנשים זה משאיר תשעה בצד בכל שאלה,
// וזה מה שהורג משחק קבוצתי. ככה כולם משחקים כל הזמן, והמרוץ עדיין קיים.

export const BASE_POINTS = 500
export const MAX_SPEED_BONUS = 500
export const STREAK_BONUS = 50
export const MAX_STREAK_BONUS = 250

export interface ScoreInput {
  correct: boolean
  /** כמה זמן לקח לענות, במילישניות, נמדד על המכשיר של השחקן */
  elapsedMs: number
  /** תקרת הזמן לשאלה, במילישניות */
  limitMs: number
  /** כמה תשובות נכונות ברצף היו לפני השאלה הזאת */
  streak: number
}

export interface ScoreResult {
  points: number
  base: number
  speedBonus: number
  streakBonus: number
}

export function scoreAnswer({ correct, elapsedMs, limitMs, streak }: ScoreInput): ScoreResult {
  if (!correct) return { points: 0, base: 0, speedBonus: 0, streakBonus: 0 }

  // חצי שנייה ראשונה נחשבת מהירות מלאה — אחרת מנצח מי שלוחץ לפני שקרא
  const grace = 500
  const usable = Math.max(limitMs - grace, 1)
  const ratio = Math.min(Math.max((elapsedMs - grace) / usable, 0), 1)
  const speedBonus = Math.round(MAX_SPEED_BONUS * (1 - ratio))
  const streakBonus = Math.min(streak * STREAK_BONUS, MAX_STREAK_BONUS)

  return {
    points: BASE_POINTS + speedBonus + streakBonus,
    base: BASE_POINTS,
    speedBonus,
    streakBonus,
  }
}

/**
 * הזמן נמדד על המכשיר של השחקן, מרגע שהשאלה הופיעה אצלו ועד הלחיצה.
 * אם היינו מודדים בשרת, מי שיש לו אינטרנט טוב היה מנצח את מי שמכיר
 * את אייל גולן טוב יותר — והתחרות הייתה על הרשת ולא על השירים.
 *
 * בגלל שהמדידה בצד הלקוח, צריך רשת ביטחון מול מי שיחליט לשלוח 0.
 */
export function sanitizeElapsed(elapsedMs: unknown, limitMs: number): number {
  const value = typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) ? elapsedMs : limitMs
  // פחות מ-250ms זה לא זמן תגובה אנושי, זה שעון שבור או ניסיון לרמות
  return Math.min(Math.max(value, 250), limitMs)
}
