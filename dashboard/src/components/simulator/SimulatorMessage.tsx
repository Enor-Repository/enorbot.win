import { cn } from '@/lib/utils'

export interface ChatMessage {
  id: string
  type: 'user' | 'bot' | 'system' | 'history'
  text: string
  senderName?: string
  route?: {
    destination: string
    dealAction: string | null
    hasTrigger: boolean
  }
  processingTimeMs?: number
  timestamp: number
}

interface SimulatorMessageProps {
  message: ChatMessage
}

export function SimulatorMessage({ message }: SimulatorMessageProps) {
  const time = new Date(message.timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (message.type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-muted/50 text-muted-foreground text-xs px-3 py-1.5 rounded-lg max-w-md text-center">
          {message.text}
          {message.route && (
            <span className="ml-2 text-yellow-500/80 font-mono">
              [{message.route.destination}]
            </span>
          )}
        </div>
      </div>
    )
  }

  const isUser = message.type === 'user'
  const isHistory = message.type === 'history'
  const isBot = message.type === 'bot'
  const isRightAligned = isUser

  return (
    <div className={cn('flex mb-2', isRightAligned ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-xl px-3 py-2 shadow-sm',
          isUser
            ? 'bg-emerald-800/60 text-white rounded-br-sm'
            : isHistory
            ? 'bg-slate-700/60 text-white rounded-bl-sm'
            : 'bg-card border border-border text-foreground rounded-bl-sm'
        )}
      >
        {/* Sender name */}
        <div className={cn(
          'text-[11px] font-medium mb-0.5',
          isUser ? 'text-emerald-300' : isHistory ? 'text-amber-400' : 'text-cyan-400'
        )}>
          {isUser ? (message.senderName || 'You') : isBot ? 'eNorBOT' : (message.senderName || 'Unknown')}
        </div>

        {/* Message text */}
        <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>

        {/* Footer: time + route badge */}
        <div className={cn(
          'flex items-center gap-2 mt-1',
          isRightAligned ? 'justify-end' : 'justify-between'
        )}>
          {!isUser && message.route && (
            <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {message.route.destination}
              {message.route.dealAction && `:${message.route.dealAction}`}
              {message.processingTimeMs != null && ` ${message.processingTimeMs}ms`}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">{time}</span>
        </div>
      </div>
    </div>
  )
}
