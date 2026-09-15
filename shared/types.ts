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
  /** שורה מפורסמת מהשיר, אם הוזנה ידנית. */
  lyricLine?: string
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
  | 'lyric' // מאיזה שיר השורה

export interface Question {
  id: string
  kind: QuestionKind
  prompt: string
  /** טקסט משני שמוצג קטן מתחת לשאלה */
  hint?: string
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
