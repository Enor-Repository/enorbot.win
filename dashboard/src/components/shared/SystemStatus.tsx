/**
 * System Status Indicator - Real-time connection and uptime display
 */
import { useState, useEffect } from 'react'
import { Activity, WifiOff } from 'lucide-react'

interface StatusData {
  connection: string
  operational: string
  uptime: number
  lastActivityAt: string
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function SystemStatus() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [lastCheck, setLastCheck] = useState<Date>(new Date())

  const checkStatus = async () => {
    try {
      const response = await fetch('http://localhost:3003/api/status', {
        signal: AbortSignal.timeout(5000), // 5 second timeout
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setStatus(data)
      setIsOnline(true)
      setLastCheck(new Date())
    } catch (error) {
      console.error('Status check failed:', error)
      setIsOnline(false)
      setLastCheck(new Date())
    }
  }

  // Initial check
  useEffect(() => {
    checkStatus()
  }, [])

  // Poll every 10 seconds
  useEffect(() => {
    const interval = setInterval(checkStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed top-4 right-4 z-50">
      <div
        className={`
          flex items-center gap-3 px-4 py-2 rounded-lg border backdrop-blur-sm font-mono text-xs
          transition-all duration-300 shadow-lg
          ${
            isOnline
              ? 'bg-green-500/10 border-green-500/30 text-green-400 shadow-green-500/20'
              : 'bg-red-500/10 border-red-500/30 text-red-400 shadow-red-500/20'
          }
        `}
      >
        {/* Status Icon */}
        <div className="relative">
          {isOnline ? (
            <>
              <Activity className="h-4 w-4" />
              <div className="absolute inset-0 animate-ping opacity-30">
                <Activity className="h-4 w-4" />
              </div>
            </>
          ) : (
            <WifiOff className="h-4 w-4" />
          )}
        </div>

        {/* Status Text */}
        <div className="flex items-center gap-2">
          {isOnline ? (
            <>
              <span className="font-semibold uppercase tracking-wider">Online</span>
              {status?.uptime && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatUptime(status.uptime)}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold uppercase tracking-wider">Offline</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground text-[10px]">
                Last: {lastCheck.toLocaleTimeString()}
              </span>
            </>
          )}
        </div>

        {/* Connection Status Indicator */}
        <div
          className={`
            w-2 h-2 rounded-full
            ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}
          `}
        />
      </div>

      {/* Extended info on hover */}
      {isOnline && status && (
        <div className="absolute top-full right-0 mt-2 w-64 opacity-0 hover:opacity-100 transition-opacity pointer-events-none hover:pointer-events-auto">
          <div className="bg-popover/95 backdrop-blur-sm border border-border/50 rounded-lg p-3 shadow-xl font-mono text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Connection:</span>
              <span className="text-green-400 font-semibold uppercase">{status.connection}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Operational:</span>
              <span className="text-cyan-400 font-semibold uppercase">{status.operational}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Activity:</span>
              <span className="text-foreground tabular-nums">
                {new Date(status.lastActivityAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
              Auto-refresh: 10s
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
