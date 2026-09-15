// ניהול חדרי המשחק. הכל בזיכרון — חדר חי כמה שעות ומת, אין מה לשמור בדיסק.

import { randomBytes, randomUUID } from 'node:crypto'
import { createRng, makeRoomCode } from '../shared/rng.ts'
import { generateQuiz } from '../shared/questions.ts'
import { matchesAnswer } from '../shared/answer-matching.ts'
import { isOpenQuestion } from '../shared/types.ts'
import { scoreAnswer, sanitizeElapsed } from '../shared/scoring.ts'
import {
  MAX_PLAYERS,
  QUESTION_TIME_MS,
  ROOM_TTL_MS,
  type PlayerView,
  type QuestionOutcome,
  type RoomConfig,
  type RoomPhase,
} from '../shared/protocol.ts'
import type { Question, Song } from '../shared/types.ts'

export interface Player {
  id: string
  token: string
  nickname: string
  score: number
  streak: number
  connected: boolean
  /** התשובה לשאלה הנוכחית, אם כבר ענה */
  currentAnswer: { choiceIndex: number; text?: string; skipped?: boolean; elapsedMs: number } | null
}

export interface Room {
  code: string
  seed: string
  hostId: string
  config: RoomConfig
  phase: RoomPhase
  players: Map<string, Player>
  questions: Question[]
  questionIndex: number
  /** מתי השאלה הנוכחית נגמרת, בשעון השרת */
  questionEndsAt: number
  lastActivity: number
}

export class RoomStore {
  private rooms = new Map<string, Room>()

  constructor(private songs: Song[]) {}

  create(nickname: string, config: RoomConfig): { room: Room; player: Player } {
    const code = this.uniqueCode()
    const seed = `${code}-${randomBytes(4).toString('hex')}`
    const host = makePlayer(nickname)

    const room: Room = {
      code,
      seed,
      hostId: host.id,
      config: normalizeConfig(config),
      phase: 'lobby',
      players: new Map([[host.id, host]]),
      questions: [],
      questionIndex: -1,
      questionEndsAt: 0,
      lastActivity: Date.now(),
    }
    this.rooms.set(code, room)
    return { room, player: host }
  }

  join(code: string, nickname: string): { room: Room; player: Player } | { error: string } {
    const room = this.get(code)
    if (!room) return { error: 'לא מצאנו חדר עם הקוד הזה' }
    if (room.phase !== 'lobby') return { error: 'המשחק כבר התחיל' }
    if (room.players.size >= MAX_PLAYERS) return { error: `החדר מלא, מקסימום ${MAX_PLAYERS} שחקנים` }

    const taken = [...room.players.values()].some(
      (p) => p.nickname.trim().toLowerCase() === nickname.trim().toLowerCase(),
    )
    if (taken) return { error: 'השם הזה כבר תפוס בחדר' }

    const player = makePlayer(nickname)
    room.players.set(player.id, player)
    room.lastActivity = Date.now()
    return { room, player }
  }

  /** חזרה לחדר אחרי שהאינטרנט קפץ — הניקוד נשמר */
  rejoin(code: string, playerId: string, token: string): { room: Room; player: Player } | { error: string } {
    const room = this.get(code)
    if (!room) return { error: 'החדר כבר לא קיים' }
    const player = room.players.get(playerId)
    if (!player || player.token !== token) return { error: 'לא הצלחנו לזהות אותך' }
    player.connected = true
    room.lastActivity = Date.now()
    return { room, player }
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase())
  }

  startGame(room: Room): { error?: string } {
    if (room.phase !== 'lobby' && room.phase !== 'finished') return { error: 'המשחק כבר רץ' }

    room.questions = generateQuiz(this.songs, {
      seed: room.seed,
      questionCount: room.config.questionCount,
      eras: room.config.eras,
      difficulties: room.config.difficulties,
      kinds: room.config.kinds,
    })
    if (!room.questions.length) return { error: 'אין מספיק שירים בסינון הזה בשביל חידון' }

    room.questionIndex = -1
    for (const player of room.players.values()) {
      player.score = 0
      player.streak = 0
      player.currentAnswer = null
    }
    return {}
  }

  /** מקדם לשאלה הבאה. מחזיר false כשנגמרו השאלות. */
  nextQuestion(room: Room): boolean {
    if (room.questionIndex + 1 >= room.questions.length) {
      room.phase = 'finished'
      room.lastActivity = Date.now()
      return false
    }
    room.questionIndex++
    room.phase = 'question'
    room.questionEndsAt = Date.now() + this.timeLimitFor(room)
    for (const player of room.players.values()) player.currentAnswer = null
    room.lastActivity = Date.now()
    return true
  }

  recordAnswer(
    room: Room,
    player: Player,
    questionIndex: number,
    choiceIndex: number,
    elapsedMs: number,
    text?: string,
    skipped?: boolean,
  ): { error?: string } {
    if (room.phase !== 'question') return { error: 'אין שאלה פתוחה כרגע' }
    if (questionIndex !== room.questionIndex) return { error: 'השאלה הזאת כבר נסגרה' }
    if (player.currentAnswer) return { error: 'כבר ענית' }

    const question = room.questions[questionIndex]
    if (!question) return { error: 'תשובה לא חוקית' }
    const limit = question.timeLimitMs ?? QUESTION_TIME_MS

    // ויתור נרשם מיד, בלי לבדוק תוכן — הוא תמיד שגוי
    if (skipped) {
      player.currentAnswer = {
        choiceIndex: -1,
        skipped: true,
        elapsedMs: sanitizeElapsed(elapsedMs, limit),
      }
      room.lastActivity = Date.now()
      return {}
    }

    if (isOpenQuestion(question)) {
      const typed = typeof text === 'string' ? text.trim().slice(0, 100) : ''
      if (!typed) return { error: 'צריך לכתוב תשובה' }
      player.currentAnswer = {
        choiceIndex: -1,
        text: typed,
        elapsedMs: sanitizeElapsed(elapsedMs, limit),
      }
    } else {
      if (choiceIndex < 0 || choiceIndex >= question.choices.length) {
        return { error: 'תשובה לא חוקית' }
      }
      player.currentAnswer = {
        choiceIndex,
        elapsedMs: sanitizeElapsed(elapsedMs, limit),
      }
    }

    room.lastActivity = Date.now()
    return {}
  }

  /** כמה זמן יש לשאלה הנוכחית */
  timeLimitFor(room: Room): number {
    return room.questions[room.questionIndex]?.timeLimitMs ?? QUESTION_TIME_MS
  }

  /** האם כל מי שמחובר כבר ענה — אז אפשר לחתוך את הטיימר */
  everyoneAnswered(room: Room): boolean {
    const active = [...room.players.values()].filter((p) => p.connected)
    return active.length > 0 && active.every((p) => p.currentAnswer)
  }

  /** סוגר את השאלה, מחשב ניקוד לכולם ומחזיר מה קרה */
  closeQuestion(room: Room): {
    answerIndex: number
    correctLabel?: string
    outcomes: QuestionOutcome[]
    isLast: boolean
  } {
    const question = room.questions[room.questionIndex]
    room.phase = 'reveal'

    const open = isOpenQuestion(question)
    const limit = question.timeLimitMs ?? QUESTION_TIME_MS

    const outcomes: QuestionOutcome[] = []
    for (const player of room.players.values()) {
      const answer = player.currentAnswer
      // בשאלה פתוחה משווים את מה שהוקלד, עם סובלנות לשגיאות כתיב
      const correct = !answer || answer.skipped
        ? false
        : open
          ? matchesAnswer(answer.text ?? '', question.accepted ?? []).correct
          : answer.choiceIndex === question.answerIndex
      const { points } = scoreAnswer({
        correct,
        elapsedMs: answer?.elapsedMs ?? limit,
        limitMs: limit,
        streak: player.streak,
      })

      player.score += points
      player.streak = correct ? player.streak + 1 : 0

      outcomes.push({
        playerId: player.id,
        nickname: player.nickname,
        correct,
        elapsedMs: answer?.elapsedMs ?? limit,
        points,
        totalScore: player.score,
        ...(answer?.text ? { text: answer.text } : {}),
        ...(answer?.skipped ? { skipped: true } : {}),
      })
    }

    outcomes.sort((a, b) => b.points - a.points || a.elapsedMs - b.elapsedMs)
    room.lastActivity = Date.now()

    return {
      answerIndex: question.answerIndex,
      correctLabel: question.correctLabel,
      outcomes,
      isLast: room.questionIndex + 1 >= room.questions.length,
    }
  }

  disconnect(room: Room, playerId: string): void {
    const player = room.players.get(playerId)
    if (!player) return
    player.connected = false
    room.lastActivity = Date.now()

    // בלובי אין מה לשמור למי שהלך; באמצע משחק הניקוד מחכה לו אם יחזור
    if (room.phase === 'lobby') room.players.delete(playerId)

    // המארח עזב — מעבירים את השרביט למי שנשאר, אחרת החדר תקוע
    if (room.hostId === playerId) {
      const heir = [...room.players.values()].find((p) => p.connected)
      if (heir) room.hostId = heir.id
    }

    if (![...room.players.values()].some((p) => p.connected)) this.rooms.delete(room.code)
  }

  view(room: Room): PlayerView[] {
    return [...room.players.values()]
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        streak: p.streak,
        connected: p.connected,
        isHost: p.id === room.hostId,
        answered: !!p.currentAnswer,
      }))
      .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'he'))
  }

  sweepStale(): void {
    const cutoff = Date.now() - ROOM_TTL_MS
    for (const [code, room] of this.rooms) {
      if (room.lastActivity < cutoff) this.rooms.delete(code)
    }
  }

  get size(): number {
    return this.rooms.size
  }

  private uniqueCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = makeRoomCode(createRng(randomUUID()))
      if (!this.rooms.has(code)) return code
    }
    // מאה אלף צירופים אפשריים, אז זה לא אמור לקרות
    throw new Error('לא הצלחנו לייצר קוד חדר פנוי')
  }
}

function makePlayer(nickname: string): Player {
  return {
    id: randomUUID(),
    token: randomBytes(16).toString('hex'),
    nickname: nickname.trim().slice(0, 20) || 'אנונימי',
    score: 0,
    streak: 0,
    connected: true,
    currentAnswer: null,
  }
}

function normalizeConfig(config: RoomConfig): RoomConfig {
  return {
    ...config,
    questionCount: Math.min(Math.max(Math.round(config.questionCount) || 10, 3), 30),
  }
}
