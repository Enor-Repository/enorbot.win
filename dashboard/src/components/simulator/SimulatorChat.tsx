import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
import { SimulatorMessage, type ChatMessage } from './SimulatorMessage'
import { SimulatorPlayerPicker } from './SimulatorPlayerPicker'
import type { SimulatorGroup } from './SimulatorGroupList'

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

  // Load history and reset chat when group changes
  useEffect(() => {
    setMessages([])
    setInput('')
    setHistoryLoaded(false)
    // Auto-select first player (prefer client, then first available)
    const players = Object.entries(group.playerRoles)
    const client = players.find(([, role]) => role === 'client')
    const cio = players.find(([, role]) => role === 'cio')
    if (group.isControlGroup && cio) {
      setSelectedPlayer(cio[0])
    } else if (client) {
      setSelectedPlayer(client[0])
    } else if (players.length > 0) {
      setSelectedPlayer(players[0][0])
    } else {
      setSelectedPlayer('')
    }

    // Fetch message history
    fetch(API_ENDPOINTS.simulatorHistory(group.groupJid))
      .then((res) => res.json())
      .then((data) => {
        if (data.messages && data.messages.length > 0) {
          const historyMsgs: ChatMessage[] = data.messages.map((m: { id: string; senderJid: string; isFromBot: boolean; messageType: string; content: string; timestamp: number }) => ({
            id: `hist-${m.id}`,
            type: m.isFromBot ? 'bot' as const : 'user' as const,
            text: m.content || '',
            senderName: m.isFromBot ? 'eNorBOT' : formatJid(m.senderJid),
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

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading || !selectedPlayer) return

    setInput('')

    // Add user message optimistically
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      text,
      senderName: formatJid(selectedPlayer),
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
          senderName: formatJid(selectedPlayer),
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
  }, [input, isLoading, selectedPlayer, group.groupJid])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

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
        </div>
        <SimulatorPlayerPicker
          playerRoles={group.playerRoles}
          selectedPlayer={selectedPlayer}
          onSelectPlayer={setSelectedPlayer}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {!historyLoaded ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : (
              'No message history. Send a message to start simulating...'
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
            placeholder={selectedPlayer ? 'Type a message...' : 'Select a player first'}
            disabled={!selectedPlayer || isLoading}
            className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !selectedPlayer || isLoading}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-xl transition-all',
              input.trim() && selectedPlayer && !isLoading
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
