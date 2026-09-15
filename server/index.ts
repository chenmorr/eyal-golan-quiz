// שרת החדרים. תפקידו היחיד הוא לתאם בין הטלפונים: מי בחדר, מתי השאלה
// נפתחת, ומי ענה מה. השאלות עצמן אף פעם לא עוברות פה — כל טלפון מייצר
// אותן לבד מה-seed.

import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { RoomStore, type Room } from './rooms.ts'
import {
  REVEAL_TIME_MS,
  type ClientMessage,
  type ServerMessage,
} from '../shared/protocol.ts'
import type { Song } from '../shared/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// QUIZ_PORT קודם ל-PORT בכוונה: על שרתים משותפים PORT כבר תפוס
// על ידי שירות אחר, והשרת היה נופל על EADDRINUSE בלי סיבה נראית לעין.
const PORT = Number(process.env.QUIZ_PORT) || Number(process.env.PORT) || 8787

const songs: Song[] = JSON.parse(readFileSync(join(ROOT, 'data', 'songs.json'), 'utf8'))
const store = new RoomStore(songs)

/** לכל חיבור פתוח: לאיזה חדר ולאיזה שחקן הוא שייך */
interface Session {
  roomCode: string
  playerId: string
}
const sessions = new Map<WebSocket, Session>()
/** טיימרים פעילים לכל חדר, כדי שאפשר יהיה לבטל אותם */
const timers = new Map<string, NodeJS.Timeout>()

// בפרודקשן אותו שרת מגיש גם את האתר וגם את החדרים, כדי שהכל יישב
// על דומיין אחד ולא יהיה צורך להתעסק ב-CORS או בשני שירותים נפרדים.
const DIST = join(ROOT, 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
}

function serveStatic(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('האתר עוד לא נבנה. הריצו npm run build')
    return
  }

  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  // normalize חוסם נתיבים כמו ../../etc/passwd
  const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '')
  let file = join(DIST, relative)

  // ה-PWA הוא עמוד אחד, אז כל נתיב לא מוכר מקבל את index.html
  if (!relative || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!file.startsWith(DIST)) return void res.writeHead(403).end()

  const ext = extname(file).toLowerCase()
  const isHashed = /-[A-Za-z0-9_]{8,}\.(js|css)$/.test(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    // קבצים עם hash בשם אף פעם לא משתנים; שאר הדברים חייבים להתרענן
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

// תיעוד בקשות — בלי זה אי אפשר לדעת אם תקלה אצל המשתמש בכלל הגיעה לשרת
const LOG_REQUESTS = process.env.QUIZ_LOG_REQUESTS !== '0'

// אם יש תעודה, מאזינים ב-HTTPS ישירות במקום לעבור דרך פרוקסי.
// Tailscale serve נראה תקין בכל בדיקה מקומית אבל תעבורה ממכשירים אחרים
// פשוט לא הגיעה לשרת, בעוד שהאזנה ישירה עם תעודה עובדת (ככה Claude HQ רץ).
const CERT = process.env.QUIZ_CERT ?? join(ROOT, 'certs', 'quiz.crt')
const KEY = process.env.QUIZ_KEY ?? join(ROOT, 'certs', 'quiz.key')
// QUIZ_HTTP=1 כופה HTTP רגיל — הבדיקות מריצות שרת מקומי ולא רוצות
// להתעסק בתעודה שמונפקת לשם דומיין אחר
const useHttps = process.env.QUIZ_HTTP !== '1' && existsSync(CERT) && existsSync(KEY)

// כתובת האזנה: ריק פירושו כל הממשקים. על השרת הזה מגבילים ל-tailnet בלבד.
const BIND = process.env.QUIZ_BIND || undefined

const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
  if (LOG_REQUESTS) {
    const ua = (req.headers['user-agent'] ?? '').slice(0, 60)
    res.on('finish', () => {
      console.log(`${new Date().toISOString()} ${res.statusCode} ${req.method} ${req.url} | ${ua}`)
    })
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
        JSON.stringify({
          ok: true,
          rooms: store.size,
          songs: songs.length,
          // מאפשר למי שהפעיל את השרת לוודא שהוא מדבר איתו ולא עם שרת ישן
          instance: process.env.QUIZ_INSTANCE ?? null,
        }),
      )
    return
  }
  serveStatic(req, res)
}

const http = useHttps
  ? createHttpsServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, handler)
  : createHttpServer(handler)

const wss = new WebSocketServer({ server: http, path: '/ws' })

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function broadcast(room: Room, message: ServerMessage): void {
  for (const [ws, session] of sessions) {
    if (session.roomCode === room.code) send(ws, message)
  }
}

function broadcastState(room: Room): void {
  broadcast(room, {
    type: 'room-state',
    code: room.code,
    phase: room.phase,
    players: store.view(room),
    seed: room.seed,
    config: room.config,
    questionIndex: room.questionIndex,
  })
}

function clearRoomTimer(code: string): void {
  const timer = timers.get(code)
  if (timer) {
    clearTimeout(timer)
    timers.delete(code)
  }
}

function startQuestion(room: Room): void {
  clearRoomTimer(room.code)
  if (!store.nextQuestion(room)) {
    broadcast(room, { type: 'game-over', leaderboard: store.view(room) })
    broadcastState(room)
    return
  }

  const limit = store.timeLimitFor(room)
  broadcast(room, {
    type: 'question-start',
    questionIndex: room.questionIndex,
    endsAt: room.questionEndsAt,
    timeLimitMs: limit,
  })
  broadcastState(room)

  timers.set(
    room.code,
    setTimeout(() => finishQuestion(room), limit),
  )
}

function finishQuestion(room: Room): void {
  clearRoomTimer(room.code)
  if (room.phase !== 'question') return

  const result = store.closeQuestion(room)
  broadcast(room, {
    type: 'question-end',
    questionIndex: room.questionIndex,
    answerIndex: result.answerIndex,
    correctLabel: result.correctLabel,
    outcomes: result.outcomes,
    isLast: result.isLast,
  })
  broadcastState(room)

  // מתקדמים לבד אחרי הצגת התשובה, כדי שהמשחק לא ייתקע אם המארח מסתכל בטלפון
  timers.set(
    room.code,
    setTimeout(() => {
      if (result.isLast) {
        room.phase = 'finished'
        broadcast(room, { type: 'game-over', leaderboard: store.view(room) })
        broadcastState(room)
      } else {
        startQuestion(room)
      }
    }, REVEAL_TIME_MS),
  )
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw))
    } catch {
      return send(ws, { type: 'error', message: 'הודעה לא תקינה' })
    }
    handle(ws, message)
  })

  ws.on('close', () => {
    const session = sessions.get(ws)
    sessions.delete(ws)
    if (!session) return
    const room = store.get(session.roomCode)
    if (!room) return
    store.disconnect(room, session.playerId)
    if (store.get(session.roomCode)) broadcastState(room)
    else clearRoomTimer(session.roomCode)
  })
})

function handle(ws: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case 'ping':
      return send(ws, { type: 'pong' })

    case 'create-room': {
      const { room, player } = store.create(message.nickname, message.config)
      sessions.set(ws, { roomCode: room.code, playerId: player.id })
      send(ws, {
        type: 'joined',
        code: room.code,
        playerId: player.id,
        token: player.token,
        seed: room.seed,
        config: room.config,
      })
      broadcastState(room)
      return
    }

    case 'join-room': {
      const result = store.join(message.code, message.nickname)
      if ('error' in result) return send(ws, { type: 'error', message: result.error })
      sessions.set(ws, { roomCode: result.room.code, playerId: result.player.id })
      send(ws, {
        type: 'joined',
        code: result.room.code,
        playerId: result.player.id,
        token: result.player.token,
        seed: result.room.seed,
        config: result.room.config,
      })
      broadcastState(result.room)
      return
    }

    case 'rejoin': {
      const result = store.rejoin(message.code, message.playerId, message.token)
      if ('error' in result) return send(ws, { type: 'error', message: result.error })
      sessions.set(ws, { roomCode: result.room.code, playerId: result.player.id })
      send(ws, {
        type: 'joined',
        code: result.room.code,
        playerId: result.player.id,
        token: result.player.token,
        seed: result.room.seed,
        config: result.room.config,
      })
      broadcastState(result.room)
      return
    }
  }

  // כל השאר דורש שכבר תהיה בחדר
  const session = sessions.get(ws)
  const room = session && store.get(session.roomCode)
  if (!session || !room) return send(ws, { type: 'error', message: 'אתה לא בחדר' })
  const isHost = room.hostId === session.playerId

  switch (message.type) {
    case 'update-config': {
      if (!isHost) return send(ws, { type: 'error', message: 'רק המארח קובע הגדרות' })
      if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'המשחק כבר התחיל' })
      room.config = { ...room.config, ...message.config }
      return broadcastState(room)
    }

    case 'start-game': {
      if (!isHost) return send(ws, { type: 'error', message: 'רק המארח מתחיל את המשחק' })
      const result = store.startGame(room)
      if (result.error) return send(ws, { type: 'error', message: result.error })
      return startQuestion(room)
    }

    case 'answer': {
      const player = room.players.get(session.playerId)
      if (!player) return
      const result = store.recordAnswer(
        room,
        player,
        message.questionIndex,
        message.choiceIndex,
        message.elapsedMs,
        message.text,
        message.skipped,
      )
      if (result.error) return send(ws, { type: 'error', message: result.error })
      broadcastState(room)
      // כולם ענו, אין טעם להמשיך לספור
      if (store.everyoneAnswered(room)) finishQuestion(room)
      return
    }

    case 'next': {
      if (!isHost) return
      if (room.phase === 'question') return finishQuestion(room)
      if (room.phase === 'reveal') return startQuestion(room)
      return
    }

    case 'play-again': {
      if (!isHost) return send(ws, { type: 'error', message: 'רק המארח מתחיל סיבוב חדש' })
      room.phase = 'lobby'
      room.questionIndex = -1
      for (const player of room.players.values()) {
        player.score = 0
        player.streak = 0
        player.currentAnswer = null
      }
      return broadcastState(room)
    }
  }
}

setInterval(() => store.sweepStale(), 10 * 60 * 1000).unref()

http.listen(PORT, BIND, () => {
  const scheme = useHttps ? 'https' : 'http'
  console.log(
    `שרת החידון עלה: ${scheme}://${BIND ?? '0.0.0.0'}:${PORT} — ${songs.length} שירים`,
  )
})
