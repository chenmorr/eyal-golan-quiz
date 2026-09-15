import { describe, expect, it } from 'vitest'
import { matchesAnswer, acceptedAnswers, normalizeAnswer } from '../shared/answer-matching.ts'

/** עוזר: בודק ניחוש מול שם שיר אמיתי */
const guess = (input: string, title: string) => matchesAnswer(input, acceptedAnswers(title)).correct

describe('זיהוי תשובה מוקלדת', () => {
  it('מקבל את השם המדויק', () => {
    expect(guess('מי שמאמין', 'מי שמאמין')).toBe(true)
    expect(guess('לילד הזה התפללתי', 'לילד הזה התפללתי')).toBe(true)
  })

  it('לא אכפת לו מרווחים מיותרים ומאותיות גדולות', () => {
    expect(guess('  מי שמאמין  ', 'מי שמאמין')).toBe(true)
    expect(guess('מי   שמאמין', 'מי שמאמין')).toBe(true)
  })

  it('סולח על כתיב מלא מול חסר', () => {
    expect(guess('בלעדיך', 'בלעדייך')).toBe(true)
    expect(guess('בלעדייך', 'בלעדיך')).toBe(true)
    expect(guess('עינייך החומות', 'עיניך החומות')).toBe(true)
  })

  it('סולח על גרשיים שהמקלדת הפכה', () => {
    expect(guess('אמא׳לה', "אמא'לה")).toBe(true)
    expect(guess('אמא"לה', "אמא'לה")).toBe(true)
  })

  it('סולח על ניקוד שנכנס בטעות', () => {
    expect(guess('מִי שֶׁמַּאֲמִין', 'מי שמאמין')).toBe(true)
  })

  it('מקבל השמטה של ה"א הידיעה', () => {
    expect(guess('לב על השולחן', 'הלב על השולחן')).toBe(true)
    expect(guess('הלב על השולחן', 'לב על השולחן')).toBe(true)
  })

  it('סולח על שגיאת הקלדה אחת בשם בינוני', () => {
    expect(guess('מי שמאמים', 'מי שמאמין')).toBe(true) // ן/ם
    expect(guess('חייל של אהבב', 'חייל של אהבה')).toBe(true)
  })

  it('סולח על שתי שגיאות בשם ארוך', () => {
    expect(guess('לילד הזה התפלתי', 'לילד הזה התפללתי')).toBe(true)
  })

  // החלק החשוב: סובלנות שהיא גם מחמירה מספיק
  it('לא מקבל שיר אחר לגמרי', () => {
    expect(guess('מי שמאמין', 'לילד הזה התפללתי')).toBe(false)
    expect(guess('דמעות', 'חלומות')).toBe(false)
  })

  it('לא מקבל שם קצר עם שגיאה, כי זה כבר שיר אחר', () => {
    expect(guess('זרה', 'זרח')).toBe(false)
    expect(guess('לב', 'רב')).toBe(false)
  })

  it('לא מקבל תשובה ריקה', () => {
    expect(guess('', 'מי שמאמין')).toBe(false)
    expect(guess('   ', 'מי שמאמין')).toBe(false)
  })

  it('לא מקבל ניחוש חלקי של מילה אחת מתוך שם ארוך', () => {
    expect(guess('לילד', 'לילד הזה התפללתי')).toBe(false)
    expect(guess('אהבה', 'חייל של אהבה')).toBe(false)
  })

  it('מדווח כשההתאמה הייתה עם שגיאת כתיב', () => {
    const exact = matchesAnswer('מי שמאמין', acceptedAnswers('מי שמאמין'))
    expect(exact.hadTypo).toBeFalsy()
    const typo = matchesAnswer('מי שמאמים', acceptedAnswers('מי שמאמין'))
    expect(typo.correct).toBe(true)
    expect(typo.hadTypo).toBe(true)
  })

  it('מתעלם מסוגריים בשם השיר', () => {
    expect(guess('זרה', 'זרה (גרסת רדיו)')).toBe(true)
  })
})

describe('נרמול טקסט', () => {
  it('מוריד ניקוד, גרשיים ופיסוק', () => {
    expect(normalizeAnswer('מִי שֶׁמַּאֲמִין!')).toBe('מי שמאמין')
    expect(normalizeAnswer("אמא'לה")).toBe('אמאלה')
  })

  it('מאחד כתיב מלא וחסר', () => {
    expect(normalizeAnswer('בלעדייך')).toBe(normalizeAnswer('בלעדיך'))
  })
})
