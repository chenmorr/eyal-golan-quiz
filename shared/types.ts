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
  | 'audio' // נחש את השיר מהקטע
  | 'lyric' // מאיזה שיר השורה

export interface Question {
  id: string
  kind: QuestionKind
  prompt: string
  /** טקסט משני שמוצג קטן מתחת לשאלה */
  hint?: string
  choices: string[]
  /** אינדקס התשובה הנכונה בתוך choices */
  answerIndex: number
  difficulty: Difficulty
  /** מה להשמיע, אם זו שאלת אודיו */
  audioClip?: string
  /** נחשף אחרי התשובה — הידע שהשחקן לוקח איתו */
  reveal: string
}

export interface QuizConfig {
  seed: string
  questionCount: number
  /** מסננים אופציונליים שהמארח בוחר לפני שמתחילים */
  eras?: string[]
  difficulties?: Difficulty[]
  kinds?: QuestionKind[]
}
