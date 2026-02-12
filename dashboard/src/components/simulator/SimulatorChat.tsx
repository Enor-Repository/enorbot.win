import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Play, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
import { SimulatorMessage, type ChatMessage } from './SimulatorMessage'
import { SimulatorPlayerPicker } from './SimulatorPlayerPicker'
import type { SimulatorGroup } from './SimulatorGroupList'

interface ReplayStep {
  input: { senderJid: string; senderName: string; content: string; timestamp: number }
  route: { destination: string; dealAction: string | null; hasTrigger: boolean }
  responses: Array<{ text: string; mentions: string[]; timestamp: number }>
  processingTimeMs: number
}

type ReplayState = 'idle' | 'loading' | 'playing' | 'done'

interface SimulatorChatProps {
  group: SimulatorGroup
}

export function SimulatorChat({ group }: SimulatorChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Replay state
  const [replayState, setReplayState] = useState<ReplayState>('idle')
  const [replayProgress, setReplayProgress] = useState({ current: 0, total: 0 })
  const abortReplayRef = useRef(false)

  // Load history and reset chat when group changes
  useEffect(() => {
    setMessages([])
    setInput('')
    setHistoryLoaded(false)
    setReplayState('idle')
    abortReplayRef.current = true // abort any running replay from previous group
    // Auto-select first player (prefer client, then first available)
    const client = group.players.find((p) => p.role === 'client')
    const cio = group.players.find((p) => p.role === 'cio')
    if (group.isControlGroup && cio) {
      setSelectedPlayer(cio.jid)
    } else if (client) {
      setSelectedPlayer(client.jid)
    } else if (group.players.length > 0) {
      setSelectedPlayer(group.players[0].jid)
    } else {
      setSelectedPlayer('')
    }

    // Fetch message history
    fetch(API_ENDPOINTS.simulatorHistory(group.groupJid))
      .then((res) => res.json())
      .then((data) => {
        if (data.messages && data.messages.length > 0) {
          const historyMsgs: ChatMessage[] = data.messages.map((m: { id: string; senderJid: string; senderName: string; isFromBot: boolean; messageType: string; content: string; timestamp: number }) => ({
            id: `hist-${m.id}`,
            type: m.isFromBot ? 'bot' as const : 'history' as const,
            text: m.content || '',
            senderName: m.senderName || (m.isFromBot ? 'eNorBOT' : formatJid(m.senderJid)),
            timestamp: m.timestamp,
          }))
          setMessages(historyMsgs)
        }
        setHistoryLoaded(true)
      })
      .catch(() => {
        setHistoryLoaded(true)
      })
  }, [group.groupJid])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const startReplay = useCallback(async () => {
    setReplayState('loading')
    setMessages([])
    abortReplayRef.current = false

    try {
      const res = await fetch(API_ENDPOINTS.simulatorReplay, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ groupId: group.groupJid }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages([{
          id: 'replay-err',
          type: 'system',
          text: `Replay error: ${data.error || 'Request failed'}`,
          timestamp: Date.now(),
        }])
        setReplayState('idle')
        return
      }

      const steps: ReplayStep[] = data.steps
      if (steps.length === 0) {
        setMessages([{
          id: 'replay-empty',
          type: 'system',
          text: 'No messages to replay.',
          timestamp: Date.now(),
        }])
        setReplayState('done')
        return
      }

      setReplayState('playing')
      setReplayProgress({ current: 0, total: steps.length })

      // Animate messages in one by one
      for (let i = 0; i < steps.length; i++) {
        if (abortReplayRef.current) break

        const step = steps[i]
        setReplayProgress({ current: i + 1, total: steps.length })

        // Add the original human message
        const inputMsg: ChatMessage = {
          id: `replay-in-${i}`,
          type: 'history',
          text: step.input.content,
          senderName: step.input.senderName,
          timestamp: step.input.timestamp,
        }
        setMessages((prev) => [...prev, inputMsg])

        // Small delay so user can watch messages appear
        await delay(120)
        if (abortReplayRef.current) break

        // Add bot responses (or system message if none)
        if (step.responses.length === 0) {
          const label =
            step.route.destination === 'IGNORED_PLAYER'
              ? 'Player is ignored'
              : step.route.destination === 'IGNORE'
              ? 'No trigger matched'
              : step.route.destination === 'OBSERVE_ONLY'
              ? 'Observed only'
              : `${step.route.destination} — no response`

          setMessages((prev) => [...prev, {
            id: `replay-sys-${i}`,
            type: 'system',
            text: label,
            route: step.route,
            timestamp: Date.now(),
          }])
        } else {
          const botMsgs: ChatMessage[] = step.responses.map((r, j) => ({
            id: `replay-bot-${i}-${j}`,
            type: 'bot' as const,
            text: r.text,
            route: step.route,
            processingTimeMs: step.processingTimeMs,
            timestamp: r.timestamp,
          }))
          setMessages((prev) => [...prev, ...botMsgs])
        }

        await delay(80)
      }

      if (!abortReplayRef.current) {
        setMessages((prev) => [...prev, {
          id: 'replay-done',
          type: 'system',
          text: `Replay complete — ${steps.length} messages, ${data.totalProcessingTimeMs}ms total`,
          timestamp: Date.now(),
        }])
      }

      setReplayState('done')
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: 'replay-err',
        type: 'system',
        text: `Replay failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        timestamp: Date.now(),
      }])
      setReplayState('idle')
    }
  }, [group.groupJid])

  const stopReplay = useCallback(() => {
    abortReplayRef.current = true
    setReplayState('done')
  }, [])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading || !selectedPlayer || replayState === 'playing') return

    setInput('')

    // Resolve player name from the players list
    const playerName = group.players.find((p) => p.jid === selectedPlayer)?.name || formatJid(selectedPlayer)

    // Add user message optimistically
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      text,
      senderName: playerName,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)

    try {
      const res = await fetch(API_ENDPOINTS.simulatorSend, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({
          groupId: group.groupJid,
          senderJid: selectedPlayer,
          senderName: playerName,
          message: text,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            type: 'system',
            text: `Error: ${data.error || 'Request failed'}`,
            timestamp: Date.now(),
          },
        ])
        return
      }

      const route = data.route

      // No responses and destination is IGNORE/OBSERVE_ONLY → system message
      if (data.responses.length === 0) {
        const label =
          route.destination === 'IGNORED_PLAYER'
            ? 'Player is ignored — no processing'
            : route.destination === 'IGNORE'
            ? 'No trigger matched — message ignored'
            : route.destination === 'OBSERVE_ONLY'
            ? 'Learning/assisted mode — message observed only'
            : `Routed to ${route.destination} — no response generated`

        setMessages((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            type: 'system',
            text: label,
            route,
            timestamp: Date.now(),
          },
        ])
        return
      }

      // Add all bot responses in a single state update to avoid multiple re-renders
      const botMessages: ChatMessage[] = data.responses.map((resp: { text: string; mentions: string[]; timestamp: number }) => ({
        id: `bot-${resp.timestamp}-${Math.random()}`,
        type: 'bot' as const,
        text: resp.text,
        route,
        processingTimeMs: data.processingTimeMs,
        timestamp: resp.timestamp,
      }))
      setMessages((prev) => [...prev, ...botMessages])
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: 'system',
          text: `Network error: ${e instanceof Error ? e.message : 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }, [input, isLoading, selectedPlayer, group.groupJid, replayState])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isReplaying = replayState === 'loading' || replayState === 'playing'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold">{group.groupName}</h2>
          {group.isControlGroup && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">
              CONTROL
            </span>
          )}
          <div className="flex-1" />
          {/* Replay controls */}
          {isReplaying ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-mono">
                {replayState === 'loading' ? 'Loading...' : `${replayProgress.current}/${replayProgress.total}`}
              </span>
              <button
                onClick={stopReplay}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            </div>
          ) : (
            <button
              onClick={startReplay}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all"
            >
              <Play className="h-3 w-3" />
              Replay
            </button>
          )}
        </div>
        <SimulatorPlayerPicker
          players={group.players}
          selectedPlayer={selectedPlayer}
          onSelectPlayer={setSelectedPlayer}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {!historyLoaded && replayState === 'idle' ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : replayState === 'loading' ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing replay...
              </div>
            ) : (
              'No message history. Send a message or press Replay to test.'
            )}
          </div>
        )}
        {messages.map((msg) => (
          <SimulatorMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border bg-card/50">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isReplaying ? 'Replay in progress...' : selectedPlayer ? 'Type a message...' : 'Select a player first'}
            disabled={!selectedPlayer || isLoading || isReplaying}
            className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !selectedPlayer || isLoading || isReplaying}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-xl transition-all',
              input.trim() && selectedPlayer && !isLoading && !isReplaying
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
