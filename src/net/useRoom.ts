import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ClientMessage,
  PlayerView,
  QuestionOutcome,
  RoomConfig,
  RoomPhase,
  ServerMessage,
} from '../../shared/protocol.ts'

/**
 * כתובת שרת החדרים.
 *
 * כשהאתר מוגש מהשרת עצמו — מתחברים לאותו דומיין וזהו.
 * אבל האתר יושב גם ב-GitHub Pages, על כתובת קבועה שלא משתנה לעולם,
 * ושם אין שרת חדרים. במקרה הזה שולפים את כתובתו מ-server.json,
 * קובץ קטן שמתעדכן כשהמנהרה מקבלת שם חדש. ככה האייקון במסך הבית
 * ממשיך לעבוד גם אחרי שכתובת המנהרה התחלפה.
 */
let cachedServer: string | null = null

async function resolveServerUrl(): Promise<string> {
  if (cachedServer) return cachedServer

  const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws'

  // האתר מוגש מהשרת עצמו (פיתוח מקומי או גישה ישירה)
  if (!isStaticHost()) {
    cachedServer = `${wsScheme}://${location.host}/ws`
    return cachedServer
  }

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}server.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    const { host } = (await res.json()) as { host: string }
    if (host) {
      cachedServer = `wss://${host}/ws`
      return cachedServer
    }
  } catch {
    // אין רשת או שהקובץ לא נגיש — נופלים לאותו דומיין וניכשל בבירור
  }

  cachedServer = `${wsScheme}://${location.host}/ws`
  return cachedServer
}

function isStaticHost(): boolean {
  return /\.github\.io$/.test(location.hostname)
}

export interface RoomState {
  status: 'idle' | 'connecting' | 'connected' | 'error'
  error: string | null
  code: string | null
  playerId: string | null
  seed: string | null
  config: RoomConfig | null
  phase: RoomPhase
  players: PlayerView[]
  questionIndex: number
  /** מתי השאלה הנוכחית נגמרת, כבר מתורגם לשעון המקומי */
  endsAt: number
  timeLimitMs: number
  revealedAnswer: number | null
  outcomes: QuestionOutcome[]
  leaderboard: PlayerView[] | null
}

const EMPTY: RoomState = {
  status: 'idle',
  error: null,
  code: null,
  playerId: null,
  seed: null,
  config: null,
  phase: 'lobby',
  players: [],
  questionIndex: -1,
  endsAt: 0,
  timeLimitMs: 20_000,
  revealedAnswer: null,
  outcomes: [],
  leaderboard: null,
}

const STORAGE_KEY = 'eyal-quiz-session'

export function useRoom() {
  const [state, setState] = useState<RoomState>(EMPTY)
  const socket = useRef<WebSocket | null>(null)
  const queue = useRef<ClientMessage[]>([])
  /**
   * הפרש בין שעון השרת לשעון המכשיר. בלי התיקון הזה טלפון שהשעון שלו
   * סוטה בכמה שניות יראה טיימר שגוי לגמרי.
   */
  const clockOffset = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connecting = useRef(false)
  const shouldReconnect = useRef(false)

  const send = useCallback((message: ClientMessage) => {
    const ws = socket.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    else queue.current.push(message)
  }, [])

  const connect = useCallback(async () => {
    if (socket.current?.readyState === WebSocket.OPEN) return
    // שליפת כתובת השרת היא אסינכרונית, אז בלי הדגל הזה שתי קריאות
    // צמודות (למשל "צור חדר" ואז reconnect) היו פותחות שני חיבורים
    if (connecting.current) return
    connecting.current = true
    setState((s) => ({ ...s, status: 'connecting', error: null }))

    let ws: WebSocket
    try {
      ws = new WebSocket(await resolveServerUrl())
    } finally {
      connecting.current = false
    }
    socket.current = ws

    ws.onopen = () => {
      setState((s) => ({ ...s, status: 'connected' }))
      const pending = queue.current
      queue.current = []
      for (const message of pending) ws.send(JSON.stringify(message))
    }

    ws.onmessage = (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      handleMessage(message)
    }

    ws.onclose = () => {
      if (!shouldReconnect.current) return
      setState((s) => ({ ...s, status: 'connecting' }))
      // האינטרנט קפץ באמצע משחק — מנסים לחזור, הניקוד מחכה בשרת
      reconnectTimer.current = setTimeout(() => {
        const saved = loadSession()
        if (saved) {
          connect()
          send({ type: 'rejoin', code: saved.code, playerId: saved.playerId, token: saved.token })
        }
      }, 1200)
    }

    ws.onerror = () => setState((s) => ({ ...s, status: 'error', error: 'אין חיבור לשרת' }))

    function handleMessage(message: ServerMessage) {
      switch (message.type) {
        case 'joined':
          shouldReconnect.current = true
          saveSession({ code: message.code, playerId: message.playerId, token: message.token })
          setState((s) => ({
            ...s,
            status: 'connected',
            error: null,
            code: message.code,
            playerId: message.playerId,
            seed: message.seed,
            config: message.config,
          }))
          break

        case 'room-state':
          setState((s) => ({
            ...s,
            code: message.code,
            phase: message.phase,
            players: message.players,
            seed: message.seed,
            config: message.config,
            questionIndex: message.questionIndex,
            // חוזרים ללובי לסיבוב חדש — מנקים את מה שנשאר מהקודם
            ...(message.phase === 'lobby'
              ? { revealedAnswer: null, outcomes: [], leaderboard: null }
              : {}),
          }))
          break

        case 'question-start':
          clockOffset.current = message.endsAt - message.timeLimitMs - Date.now()
          setState((s) => ({
            ...s,
            phase: 'question',
            questionIndex: message.questionIndex,
            endsAt: message.endsAt - clockOffset.current,
            timeLimitMs: message.timeLimitMs,
            revealedAnswer: null,
            outcomes: [],
          }))
          break

        case 'question-end':
          setState((s) => ({
            ...s,
            phase: 'reveal',
            revealedAnswer: message.answerIndex,
            outcomes: message.outcomes,
          }))
          break

        case 'game-over':
          setState((s) => ({ ...s, phase: 'finished', leaderboard: message.leaderboard }))
          break

        case 'error':
          setState((s) => ({ ...s, error: message.message }))
          break

        case 'pong':
          break
      }
    }
  }, [send])

  useEffect(() => {
    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      socket.current?.close()
    }
  }, [])

  const createRoom = useCallback(
    (nickname: string, config: RoomConfig) => {
      connect()
      send({ type: 'create-room', nickname, config })
    },
    [connect, send],
  )

  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      connect()
      send({ type: 'join-room', code: code.trim().toUpperCase(), nickname })
    },
    [connect, send],
  )

  const leave = useCallback(() => {
    shouldReconnect.current = false
    clearSession()
    socket.current?.close()
    socket.current = null
    setState(EMPTY)
  }, [])

  const me = state.players.find((p) => p.id === state.playerId) ?? null

  return {
    ...state,
    me,
    isHost: !!me?.isHost,
    createRoom,
    joinRoom,
    leave,
    startGame: useCallback(() => send({ type: 'start-game' }), [send]),
    updateConfig: useCallback((config: RoomConfig) => send({ type: 'update-config', config }), [send]),
    answer: useCallback(
      (questionIndex: number, choiceIndex: number, elapsedMs: number) =>
        send({ type: 'answer', questionIndex, choiceIndex, elapsedMs }),
      [send],
    ),
    next: useCallback(() => send({ type: 'next' }), [send]),
    playAgain: useCallback(() => send({ type: 'play-again' }), [send]),
    clearError: useCallback(() => setState((s) => ({ ...s, error: null })), []),
  }
}

interface SavedSession {
  code: string
  playerId: string
  token: string
}

function saveSession(session: SavedSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // מצב פרטי בספארי חוסם אחסון. אז לא תהיה התאוששות מניתוק, לא נורא.
  }
}

function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedSession) : null
  } catch {
    return null
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // אין מה לעשות
  }
}
