export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Song {
  id: string
  title: string
  year: number | null
  album: string | null
  features: string[]
  liveOnly: boolean
  otherAlbums: string[]
  lengthMs: number | null
  appearances: number
  era: string | null
  isTitleTrack: boolean
  difficulty: Difficulty
  /** נתיב לקטע אודיו קצר, אם הועלה. בלי זה שאלות הזיהוי לא נוצרות. */
  audioClip?: string
  /** שורה מהשיר, לשאלות "מאיפה השורה". לא מכילה את שם השיר. */
  lyricLine?: string
  /**
   * האם שם השיר מופיע במילים. אם כן, הוא כמעט בוודאות נשמע בקטע
   * (הקטע של אפל מתחיל סביב הפזמון), ואז אסור לשאול "איזה שיר זה"
   * כי התשובה נאמרת באוזניים. undefined = לא ידוע, מתייחסים כאילו כן.
   */
  titleInLyrics?: boolean
  /** זוג שורות רצופות מהשיר, לשאלת "מה השורה הבאה" */
  nextLine?: { line: string; next: string }
  /** שורה עם מילה שהוחסרה, והמילה עצמה */
  gap?: { line: string; word: string }
}

export type QuestionKind =
  | 'year' // באיזו שנה יצא השיר
  | 'album' // מאיזה אלבום השיר
  | 'which-first' // מה יצא קודם
  | 'album-song' // איזה שיר מהאלבום הזה
  | 'feature' // עם מי הוא שר
  | 'title-track' // איזה שיר נתן לאלבום את שמו
  | 'era' // מאיזו תקופה השיר
  | 'odd-one-out' // איזה שיר לא שייך
  | 'audio' // נחש את השיר מהקטע, ארבע אפשרויות
  | 'audio-open' // נחש את השיר מהקטע והקלד את השם, בלי אפשרויות
  | 'audio-album' // מאיזה אלבום הקטע שמתנגן
  | 'audio-year' // באיזו שנה יצא הקטע שמתנגן
  | 'lyric' // מאיזה שיר השורה, ארבע אפשרויות
  | 'lyric-open' // מאיזה שיר השורה, בהקלדה
  | 'album-order' // איזה אלבום יצא קודם
  | 'guest-count' // עם מי אייל שר הכי הרבה
  | 'next-line' // מה השורה הבאה בשיר
  | 'fill-gap' // איזו מילה חסרה בשורה
  | 'oldest' // איזה מהשירים האלה הכי ותיק
  | 'longest' // איזה מהשירים האלה הכי ארוך
  | 'real-or-fake' // שיר אמיתי או שם מומצא

export interface Question {
  id: string
  kind: QuestionKind
  prompt: string
  /** טקסט משני שמוצג קטן מתחת לשאלה */
  hint?: string
  /** ציטוט שהוא לב השאלה, מוצג בגדול ולא כהערת שוליים */
  quote?: string
  /** ריק בשאלה פתוחה — שם השחקן מקליד במקום לבחור */
  choices: string[]
  /** אינדקס התשובה הנכונה בתוך choices. ‎-1 בשאלה פתוחה */
  answerIndex: number
  difficulty: Difficulty
  /** מה להשמיע, אם זו שאלת אודיו */
  audioClip?: string
  /**
   * כמה שניות מהקטע להשמיע. קצר יותר = קשה יותר, ונגזר מרמת הקושי
   * של השיר: שיר שכולם מכירים מקבל יותר זמן, נדיר מקבל שתי שניות.
   */
  clipSeconds?: number
  /** מאיזו שנייה בקטע להתחיל, כשההתחלה שקטה */
  clipStart?: number
  /**
   * כמה זמן יש לענות. שאלה פתוחה מקבלת יותר, כי להקליד שם שיר
   * בעברית על מקלדת בטלפון לוקח פי כמה מללחוץ על כפתור.
   */
  timeLimitMs?: number
  /** שאלה פתוחה: כל הניסוחים שנחשבים תשובה נכונה */
  accepted?: string[]
  /** התשובה הנכונה כפי שמציגים אותה אחרי הסיבוב */
  correctLabel?: string
  /** נחשף אחרי התשובה — הידע שהשחקן לוקח איתו */
  reveal: string
}

/** שאלה שבה מקלידים במקום לבחור מארבע אפשרויות */
export function isOpenQuestion(q: Question): boolean {
  return q.choices.length === 0 && !!q.accepted?.length
}

export interface QuizConfig {
  seed: string
  questionCount: number
  /**
   * קטעי האודיו נמשכים מהשרתים של אפל, אז בלי רשת הם לא מתנגנים.
   * כשמשחקים אופליין מדלגים על סוגי השאלות שתלויים בהם במקום
   * להציג שאלה שאי אפשר לענות עליה.
   */
  allowAudio?: boolean
  /** מסננים אופציונליים שהמארח בוחר לפני שמתחילים */
  eras?: string[]
  difficulties?: Difficulty[]
  kinds?: QuestionKind[]
}
