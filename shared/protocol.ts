// הפרוטוקול בין הטלפונים לשרת.
//
// שימו לב למה שלא עובר פה: השאלות עצמן. השרת שולח seed, וכל טלפון
// מייצר מהמאגר שכבר יושב עליו את אותן עשר שאלות בדיוק. מה שרץ ברשת
// הוא "ענה ב', אחרי 1400 מילישניות" — כמה בייטים. ככה זה עובד גם
// כשהחבר'ה על דאטה חלש, וככה אותו קוד משחק גם בלי רשת בכלל.

import type { Difficulty, QuestionKind } from './types.ts'

export const MAX_PLAYERS = 10
export const QUESTION_TIME_MS = 20_000
/** כמה זמן מציגים את התשובה הנכונה לפני השאלה הבאה */
export const REVEAL_TIME_MS = 5_000
/** כמה זמן חדר שרוף נשאר בזיכרון לפני שהוא נמחק */
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000

export interface RoomConfig {
  questionCount: number
  eras?: string[]
  difficulties?: Difficulty[]
  kinds?: QuestionKind[]
}

export interface PlayerView {
  id: string
  nickname: string
  score: number
  streak: number
  connected: boolean
  isHost: boolean
  /** האם כבר ענה על השאלה הנוכחית (בלי לחשוף מה) */
  answered: boolean
}

export type RoomPhase = 'lobby' | 'question' | 'reveal' | 'finished'

export interface QuestionOutcome {
  playerId: string
  nickname: string
  correct: boolean
  elapsedMs: number
  points: number
  totalScore: number
}

// --- מה שהטלפון שולח לשרת ---
export type ClientMessage =
  | { type: 'create-room'; nickname: string; config: RoomConfig }
  | { type: 'join-room'; code: string; nickname: string }
  | { type: 'rejoin'; code: string; playerId: string; token: string }
  | { type: 'update-config'; config: RoomConfig }
  | { type: 'start-game' }
  | { type: 'answer'; questionIndex: number; choiceIndex: number; elapsedMs: number }
  | { type: 'next' }
  | { type: 'play-again' }
  | { type: 'ping' }

// --- מה שהשרת שולח לטלפון ---
export type ServerMessage =
  | {
      type: 'joined'
      code: string
      playerId: string
      /** סוד שמאפשר לחזור לחדר אחרי ניתוק בלי שמישהו יתחזה */
      token: string
      seed: string
      config: RoomConfig
    }
  | {
      type: 'room-state'
      code: string
      phase: RoomPhase
      players: PlayerView[]
      seed: string
      config: RoomConfig
      questionIndex: number
    }
  | { type: 'question-start'; questionIndex: number; endsAt: number; timeLimitMs: number }
  | {
      type: 'question-end'
      questionIndex: number
      answerIndex: number
      outcomes: QuestionOutcome[]
      isLast: boolean
    }
  | { type: 'game-over'; leaderboard: PlayerView[] }
  | { type: 'error'; message: string }
  | { type: 'pong' }
