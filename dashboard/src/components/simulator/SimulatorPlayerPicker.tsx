import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { SimulatorPlayer } from './SimulatorGroupList'

interface SimulatorPlayerPickerProps {
  players: SimulatorPlayer[]
  selectedPlayer: string
  onSelectPlayer: (jid: string) => void
}

const ROLE_COLORS: Record<string, string> = {
  operator: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  client: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  cio: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
  ignore: 'text-red-400 bg-red-500/15 border-red-500/30',
}

export function SimulatorPlayerPicker({ players, selectedPlayer, onSelectPlayer }: SimulatorPlayerPickerProps) {
  const [customJid, setCustomJid] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  // Sort: roles first (operator, client, cio), then others alphabetically by name
  const sorted = [...players].sort((a, b) => {
    if (a.role && !b.role) return -1
    if (!a.role && b.role) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground font-medium">Send as:</label>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((player) => (
          <button
            key={player.jid}
            onClick={() => { setShowCustom(false); onSelectPlayer(player.jid) }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border transition-all',
              selectedPlayer === player.jid && !showCustom
                ? 'ring-1 ring-primary border-primary/50 bg-primary/10'
                : 'border-border hover:bg-accent/50'
            )}
          >
            <span>{player.name}</span>
            {player.role && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', ROLE_COLORS[player.role] || 'text-muted-foreground bg-muted border-border')}>
                {player.role}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(true)}
          className={cn(
            'px-2 py-1 rounded-lg text-xs border transition-all',
            showCustom
              ? 'ring-1 ring-primary border-primary/50 bg-primary/10'
              : 'border-border hover:bg-accent/50 text-muted-foreground'
          )}
        >
          Custom JID
        </button>
      </div>
      {showCustom && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="5511999999999@s.whatsapp.net"
            value={customJid}
            onChange={(e) => setCustomJid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customJid.trim()) {
                onSelectPlayer(customJid.trim())
              }
            }}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => { if (customJid.trim()) onSelectPlayer(customJid.trim()) }}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90"
          >
            Set
          </button>
        </div>
      )}
    </div>
  )
}
