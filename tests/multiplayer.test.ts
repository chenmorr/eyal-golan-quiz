// בדיקה מקצה לקצה של חדר אמיתי: מריצה את השרת בתהליך נפרד,
// מחברת אליו כמה "טלפונים" ומשחקת משחק שלם.
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import songsJson from '../data/songs.json'
import { generateQuiz } from '../shared/questions.ts'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import type { Song } from '../shared/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8799
const SONGS = songsJson as Song[]

let server: ChildProcess

/** טלפון מדומה: שולח הודעות ואוסף את מה שחוזר */
class FakePhone {
  ws: WebSocket
  inbox: ServerMessage[] = []
  playerId: string | null = null
  seed: string | null = null

  constructor(public name: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}`)
    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage
      this.inbox.push(message)
      if (message.type === 'joined') {
        this.playerId = message.playerId
        this.seed = message.seed
      }
    })
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve()
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message))
  }

  /** מחכה להודעה מסוג מסוים ומחזיר אותה */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 4000,
    match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = this.inbox.find(
        (m) => m.type === type && match(m as Extract<ServerMessage, { type: T }>),
      )
      if (found) return found as Extract<ServerMessage, { type: T }>
      await sleep(25)
    }
    throw new Error(`${this.name}: לא הגיעה הודעת "${type}". התקבלו: ${this.types()}`)
  }

  types(): string {
    return [...new Set(this.inbox.map((m) => m.type))].join(', ') || 'כלום'
  }

  latest<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.type === type) as never
  }

  clear(): void {
    this.inbox = []
  }

  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, QUIZ_PORT: String(PORT) },
    stdio: 'pipe',
  })

  // מחכים שהשרת יענה, במקום להמר על זמן קבוע
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`)
      if (res.ok) return
    } catch {
      // עוד לא עלה
    }
    await sleep(200)
  }
  throw new Error('השרת לא עלה בזמן')
}, 30_000)

afterAll(() => {
  server?.kill()
})

describe('חדר משחק', () => {
  it('מארח פותח חדר ומקבל קוד בן ארבעה תווים', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 5 } })

    const joined = await host.waitFor('joined')
    expect(joined.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/)
    expect(joined.seed).toBeTruthy()
    host.close()
  })

  it('שחקנים מצטרפים עם הקוד ורואים אחד את השני', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 5 } })
    const { code } = await host.waitFor('joined')

    const guest = new FakePhone('אורח')
    await guest.ready()
    guest.send({ type: 'join-room', code, nickname: 'דני' })
    await guest.waitFor('joined')

    await sleep(150)
    const state = host.latest('room-state')!
    expect(state.players.map((p) => p.nickname).sort()).toEqual(['דני', 'חן'])
    expect(state.players.find((p) => p.nickname === 'חן')?.isHost).toBe(true)

    host.close()
    guest.close()
  })

  it('קוד שגוי מוחזר עם הודעה ברורה', async () => {
    const phone = new FakePhone('אורח')
    await phone.ready()
    phone.send({ type: 'join-room', code: 'ZZZZ', nickname: 'מישהו' })
    const error = await phone.waitFor('error')
    expect(error.message).toContain('לא מצאנו חדר')
    phone.close()
  })

  it('אי אפשר לקחת שם שכבר תפוס בחדר', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 5 } })
    const { code } = await host.waitFor('joined')

    const impostor = new FakePhone('מתחזה')
    await impostor.ready()
    impostor.send({ type: 'join-room', code, nickname: 'חן' })
    const error = await impostor.waitFor('error')
    expect(error.message).toContain('תפוס')

    host.close()
    impostor.close()
  })

  it('החדר נחסם בעשרה שחקנים', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'שחקן0', config: { questionCount: 5 } })
    const { code } = await host.waitFor('joined')

    const others: FakePhone[] = []
    for (let i = 1; i < 10; i++) {
      const phone = new FakePhone(`שחקן${i}`)
      await phone.ready()
      phone.send({ type: 'join-room', code, nickname: `שחקן${i}` })
      await phone.waitFor('joined')
      others.push(phone)
    }

    const eleventh = new FakePhone('אחד יותר מדי')
    await eleventh.ready()
    eleventh.send({ type: 'join-room', code, nickname: 'מאוחר' })
    const error = await eleventh.waitFor('error')
    expect(error.message).toContain('מלא')

    host.close()
    eleventh.close()
    for (const phone of others) phone.close()
  }, 20_000)

  it('רק המארח יכול להתחיל את המשחק', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 5 } })
    const { code } = await host.waitFor('joined')

    const guest = new FakePhone('אורח')
    await guest.ready()
    guest.send({ type: 'join-room', code, nickname: 'דני' })
    await guest.waitFor('joined')
    guest.clear()

    guest.send({ type: 'start-game' })
    const error = await guest.waitFor('error')
    expect(error.message).toContain('רק המארח')

    host.close()
    guest.close()
  })
})

describe('משחק שלם', () => {
  it('שלושה שחקנים משחקים סיבוב, והמהיר צובר יותר מהאיטי', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 3 } })
    const { code, seed } = await host.waitFor('joined')

    const fast = new FakePhone('מהיר')
    const slow = new FakePhone('איטי')
    for (const [phone, name] of [
      [fast, 'מהיר'],
      [slow, 'איטי'],
    ] as const) {
      await phone.ready()
      phone.send({ type: 'join-room', code, nickname: name })
      await phone.waitFor('joined')
    }

    // כל טלפון מייצר לעצמו את אותן שאלות מה-seed. זה כל הרעיון:
    // השאלות לא עברו ברשת, ובכל זאת כולם משחקים את אותו משחק.
    const questions = generateQuiz(SONGS, { seed, questionCount: 3 })
    expect(questions).toHaveLength(3)

    host.send({ type: 'start-game' })

    // מחכים לכל שאלה לפי המספר שלה ולא מנקים את התיבה, אחרת השאלה הבאה
    // עלולה להגיע ולהימחק לפני שהספקנו לראות אותה
    for (let i = 0; i < 3; i++) {
      for (const phone of [host, fast, slow]) {
        await phone.waitFor('question-start', 10_000, (m) => m.questionIndex === i)
      }
      const question = questions[i]

      // כולם עונים נכון, אבל בזמנים שונים
      host.send({ type: 'answer', questionIndex: i, choiceIndex: question.answerIndex, elapsedMs: 5000 })
      fast.send({ type: 'answer', questionIndex: i, choiceIndex: question.answerIndex, elapsedMs: 1200 })
      slow.send({ type: 'answer', questionIndex: i, choiceIndex: question.answerIndex, elapsedMs: 15_000 })

      const end = await fast.waitFor('question-end', 10_000, (m) => m.questionIndex === i)
      // ההוכחה שהארכיטקטורה עובדת: הלקוח חישב את התשובה לבד מה-seed,
      // והשרת הגיע לאותה תשובה בדיוק בלי שהשאלה עברה ביניהם
      expect(end.answerIndex).toBe(question.answerIndex)
      expect(end.outcomes.every((o) => o.correct)).toBe(true)
    }

    const over = await fast.waitFor('game-over', 12_000)
    const board = over.leaderboard
    const fastScore = board.find((p) => p.nickname === 'מהיר')!.score
    const slowScore = board.find((p) => p.nickname === 'איטי')!.score

    expect(fastScore).toBeGreaterThan(slowScore)
    // כולם ענו נכון, אז לאף אחד אין אפס — זה ההבדל מ"הראשון לוקח הכל"
    expect(slowScore).toBeGreaterThan(0)
    expect(board[0].nickname).toBe('מהיר')

    host.close()
    fast.close()
    slow.close()
  }, 40_000)

  it('תשובה שגויה לא מזכה בנקודות, ותשובה כפולה נחסמת', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 1 } })
    const { code, seed } = await host.waitFor('joined')

    // צריך שחקן שני שלא ממהר לענות, אחרת השאלה נסגרת ברגע שהראשון עונה
    const bystander = new FakePhone('צופה')
    await bystander.ready()
    bystander.send({ type: 'join-room', code, nickname: 'עומד בצד' })
    await bystander.waitFor('joined')

    // השרת כופה מינימום שלוש שאלות, אז מייצרים לפי מה שהוא באמת בנה
    const joinedConfig = (await host.waitFor('room-state')).config
    const questions = generateQuiz(SONGS, { seed, ...joinedConfig })

    host.send({ type: 'start-game' })
    await host.waitFor('question-start')
    host.clear()

    const wrong = (questions[0].answerIndex + 1) % questions[0].choices.length
    host.send({ type: 'answer', questionIndex: 0, choiceIndex: wrong, elapsedMs: 900 })
    await sleep(250)
    host.send({ type: 'answer', questionIndex: 0, choiceIndex: questions[0].answerIndex, elapsedMs: 950 })

    const error = await host.waitFor('error', 3000)
    expect(error.message).toContain('כבר ענית')

    // עכשיו גם השני עונה, השאלה נסגרת ואפשר לראות מי קיבל מה
    bystander.send({ type: 'answer', questionIndex: 0, choiceIndex: questions[0].answerIndex, elapsedMs: 3000 })

    const end = await host.waitFor('question-end', 10_000)
    expect(end.outcomes.find((o) => o.nickname === 'חן')!.points).toBe(0)
    expect(end.outcomes.find((o) => o.nickname === 'עומד בצד')!.points).toBeGreaterThan(0)

    host.close()
    bystander.close()
  }, 30_000)

  it('שחקן שהתנתק באמצע חוזר עם הניקוד שלו', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 3 } })
    const { code, seed } = await host.waitFor('joined')

    const flaky = new FakePhone('מתנתק')
    await flaky.ready()
    flaky.send({ type: 'join-room', code, nickname: 'רועי' })
    const flakyJoin = await flaky.waitFor('joined')
    const questions = generateQuiz(SONGS, { seed, questionCount: 3 })

    host.send({ type: 'start-game' })
    await flaky.waitFor('question-start')

    // עונה נכון ומרוויח נקודות. גם המארח עונה, אחרת השאלה תחכה
    // עשרים שניות לטיימר במקום להיסגר ברגע שכולם ענו.
    flaky.send({ type: 'answer', questionIndex: 0, choiceIndex: questions[0].answerIndex, elapsedMs: 1000 })
    host.send({ type: 'answer', questionIndex: 0, choiceIndex: questions[0].answerIndex, elapsedMs: 4000 })
    const end = await flaky.waitFor('question-end', 8000)
    const scoreBefore = end.outcomes.find((o) => o.nickname === 'רועי')!.totalScore
    expect(scoreBefore).toBeGreaterThan(0)

    // האינטרנט קפץ
    flaky.close()
    await sleep(300)

    const returning = new FakePhone('חוזר')
    await returning.ready()
    returning.send({
      type: 'rejoin',
      code,
      playerId: flakyJoin.playerId,
      token: flakyJoin.token,
    })
    await returning.waitFor('joined')

    const state = await returning.waitFor('room-state')
    const me = state.players.find((p) => p.nickname === 'רועי')!
    expect(me.score).toBe(scoreBefore)
    expect(me.connected).toBe(true)

    host.close()
    returning.close()
  }, 30_000)

  it('כשהמארח עוזב, מישהו אחר מקבל את השרביט', async () => {
    const host = new FakePhone('מארח')
    await host.ready()
    host.send({ type: 'create-room', nickname: 'חן', config: { questionCount: 5 } })
    const { code } = await host.waitFor('joined')

    const guest = new FakePhone('אורח')
    await guest.ready()
    guest.send({ type: 'join-room', code, nickname: 'דני' })
    await guest.waitFor('joined')
    await sleep(150)

    host.close()
    await sleep(400)

    const state = guest.latest('room-state')!
    expect(state.players.find((p) => p.nickname === 'דני')?.isHost).toBe(true)

    guest.close()
  })
})
