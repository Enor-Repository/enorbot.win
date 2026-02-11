import { useState } from 'react'
import { cn } from '@/lib/utils'

interface SimulatorPlayerPickerProps {
  playerRoles: Record<string, string>
  selectedPlayer: string
  onSelectPlayer: (jid: string) => void
}

const ROLE_COLORS: Record<string, string> = {
  operator: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  client: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  cio: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
  ignore: 'text-red-400 bg-red-500/15 border-red-500/30',
}

function formatJid(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '')
}

export function SimulatorPlayerPicker({ playerRoles, selectedPlayer, onSelectPlayer }: SimulatorPlayerPickerProps) {
  const [customJid, setCustomJid] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const players = Object.entries(playerRoles)

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground font-medium">Send as:</label>
      <div className="flex flex-wrap gap-1.5">
        {players.map(([jid, role]) => (
          <button
            key={jid}
            onClick={() => { setShowCustom(false); onSelectPlayer(jid) }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border transition-all',
              selectedPlayer === jid && !showCustom
                ? 'ring-1 ring-primary border-primary/50 bg-primary/10'
                : 'border-border hover:bg-accent/50'
            )}
          >
            <span className="font-mono">{formatJid(jid)}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', ROLE_COLORS[role] || 'text-muted-foreground bg-muted border-border')}>
              {role}
            </span>
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
