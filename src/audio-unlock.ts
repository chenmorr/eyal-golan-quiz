// נגן אודיו יחיד לכל האפליקציה.
//
// הבעיה שזה פותר: ספארי בנייד מרשה ניגון רק כתגובה ישירה למגע של
// המשתמש. כשכל שאלה יוצרת אלמנט audio חדש ומנסה לנגן אותו אחרי
// שהמסך התחלף, המגע כבר "נגמר" והדפדפן חוסם בשקט — השחקן רואה
// שאלת אודיו ולא שומע כלום.
//
// הפתרון הסטנדרטי: אלמנט אחד שנפתח פעם אחת בלחיצה אמיתית (הכפתור
// "מתחילים"), ומאותו רגע מותר לנגן בו מתי שרוצים. אחר כך רק מחליפים
// src במקום ליצור אלמנט חדש.

let element: HTMLAudioElement | null = null
let unlocked = false

/** אלמנט האודיו המשותף. נוצר פעם אחת. */
export function getAudioElement(): HTMLAudioElement {
  if (!element) {
    element = new Audio()
    element.preload = 'auto'
    // crossOrigin נדרש כדי ש-CDN של אפל ייתן לנו לנגן בלי אזהרות
    element.crossOrigin = 'anonymous'
    // מוסיפים ל-DOM: חלק מגרסאות ספארי מתעלמות מנגן שלא מחובר,
    // וזה גם מה שמאפשר לבדוק מבחוץ שהניגון באמת קורה
    element.setAttribute('aria-hidden', 'true')
    element.style.display = 'none'
    document.body.appendChild(element)
  }
  return element
}

/**
 * לקרוא מתוך מטפל אירוע של לחיצה אמיתית. מנגן קטע שקט באורך אפס
 * כדי לקבל מהדפדפן את ההרשאה, ומאותו רגע ניגון אוטומטי עובד.
 */
export function unlockAudio(): void {
  if (unlocked) return
  const el = getAudioElement()
  try {
    // WAV ריק באורך אפס — הדבר הקטן ביותר שמספיק כדי "לגעת" בנגן
    el.src =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
    el.muted = true
    el.play()
      .then(() => {
        el.pause()
        el.muted = false
        unlocked = true
      })
      .catch(() => {
        el.muted = false
      })
  } catch {
    // אם גם זה נכשל, נשאר כפתור ההשמעה הידני
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked
}
