import { useEffect, useState } from 'react'
import { Home } from './screens/Home.tsx'
import { Setup } from './screens/Setup.tsx'
import { SoloGame, type SoloResult } from './screens/SoloGame.tsx'
import { Lobby } from './screens/Lobby.tsx'
import { MultiGame } from './screens/MultiGame.tsx'
import { Results } from './screens/Results.tsx'
import { useRoom } from './net/useRoom.ts'
import type { RoomConfig } from '../shared/protocol.ts'

type Screen =
  | { name: 'home' }
  | { name: 'solo-setup' }
  | { name: 'solo-game'; seed: string }
  | { name: 'solo-results'; result: SoloResult }
  | { name: 'host-setup' }
  | { name: 'room' }

const DEFAULT_CONFIG: RoomConfig = { questionCount: 10 }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG)
  const [editingRoomConfig, setEditingRoomConfig] = useState(false)
  const online = useOnline()
  const room = useRoom()

  // השרת אישר כניסה לחדר — עוברים למסך החדר
  useEffect(() => {
    if (room.code && screen.name !== 'room') setScreen({ name: 'room' })
  }, [room.code, screen.name])

  function startSolo(chosen: RoomConfig) {
    setConfig(chosen)
    // seed טרי בכל משחק, אחרת מקבלים את אותן שאלות שוב ושוב
    setScreen({ name: 'solo-game', seed: `solo-${Date.now()}-${Math.random().toString(36).slice(2)}` })
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-5">
      {room.error && (
        <div
          role="alert"
          onClick={room.clearError}
          className="fixed inset-x-0 top-0 z-50 cursor-pointer bg-wine px-5 py-3 text-center text-sm font-medium"
        >
          {room.error}
        </div>
      )}

      {screen.name === 'home' && (
        <Home
          online={online}
          onSolo={() => setScreen({ name: 'solo-setup' })}
          onHost={() => setScreen({ name: 'host-setup' })}
          onJoin={(code, nickname) => room.joinRoom(code, nickname)}
        />
      )}

      {screen.name === 'solo-setup' && (
        <Setup
          initial={config}
          title="משחק לבד"
          submitLabel="יאללה, מתחילים"
          onSubmit={startSolo}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}

      {screen.name === 'solo-game' && (
        <SoloGame
          config={config}
          seed={screen.seed}
          onFinish={(result) => setScreen({ name: 'solo-results', result })}
          onQuit={() => setScreen({ name: 'home' })}
        />
      )}

      {screen.name === 'solo-results' && (
        <Results
          solo={screen.result}
          onPlayAgain={() => startSolo(config)}
          onHome={() => setScreen({ name: 'home' })}
        />
      )}

      {screen.name === 'host-setup' && (
        <Setup
          initial={config}
          title="משחק עם חברים"
          submitLabel="לפתוח חדר"
          onSubmit={(chosen) => {
            setConfig(chosen)
            const nickname = localStorage.getItem('eyal-quiz-nickname') || 'המארח'
            room.createRoom(nickname, chosen)
          }}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}

      {screen.name === 'room' && room.code && room.seed && room.config && (
        <RoomScreen
          room={room}
          editingConfig={editingRoomConfig}
          onEditConfig={() => setEditingRoomConfig(true)}
          onCloseConfig={() => setEditingRoomConfig(false)}
          onHome={() => {
            room.leave()
            setEditingRoomConfig(false)
            setScreen({ name: 'home' })
          }}
        />
      )}
    </div>
  )
}

function RoomScreen({
  room,
  editingConfig,
  onEditConfig,
  onCloseConfig,
  onHome,
}: {
  room: ReturnType<typeof useRoom>
  editingConfig: boolean
  onEditConfig: () => void
  onCloseConfig: () => void
  onHome: () => void
}) {
  const config = room.config!

  if (editingConfig) {
    return (
      <Setup
        initial={config}
        title="הגדרות החדר"
        submitLabel="לשמור"
        note="השינויים חלים על כל מי שבחדר"
        onSubmit={(next) => {
          room.updateConfig(next)
          onCloseConfig()
        }}
        onBack={onCloseConfig}
      />
    )
  }

  if (room.phase === 'finished' && room.leaderboard) {
    return (
      <Results
        leaderboard={room.leaderboard}
        playerId={room.playerId}
        isHost={room.isHost}
        onPlayAgain={room.playAgain}
        onHome={onHome}
      />
    )
  }

  if (room.phase === 'question' || room.phase === 'reveal') {
    return (
      <MultiGame
        seed={room.seed!}
        config={config}
        questionIndex={room.questionIndex}
        endsAt={room.endsAt}
        timeLimitMs={room.timeLimitMs}
        revealedAnswer={room.revealedAnswer}
        outcomes={room.outcomes}
        players={room.players}
        playerId={room.playerId}
        isHost={room.isHost}
        onAnswer={room.answer}
        onNext={room.next}
      />
    )
  }

  return (
    <Lobby
      code={room.code!}
      players={room.players}
      config={config}
      isHost={room.isHost}
      onStart={room.startGame}
      onEditConfig={onEditConfig}
      onLeave={onHome}
    />
  )
}

/** משחק לבד עובד אופליין, אז צריך לדעת מתי להסתיר את האפשרויות שדורשות רשת */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
