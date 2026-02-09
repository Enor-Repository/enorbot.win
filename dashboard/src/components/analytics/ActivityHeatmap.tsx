/**
 * Activity Heatmap Component - Professional Terminal Aesthetic
 * Insights-first, executive-friendly layout with SVG icons
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ChevronDown, ChevronUp, TrendingUp } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/api'

interface HeatmapCell {
  hour: number
  dayOfWeek: number
  count: number
  topTrigger?: string | null
}

interface ActivityHeatmapProps {
  groupId: string
  days?: number
  onCellClick?: (hour: number, dayOfWeek: number) => void
}

interface PeakHour {
  timeRange: string
  hour: number
  count: number
}

interface BusiestDay {
  day: string
  dayIndex: number
  count: number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatTimeRange(hour: number): string {
  const nextHour = (hour + 2) % 24
  const ampm1 = hour < 12 ? 'AM' : 'PM'
  const ampm2 = nextHour < 12 ? 'AM' : 'PM'
  const h1 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const h2 = nextHour === 0 ? 12 : nextHour > 12 ? nextHour - 12 : nextHour
  return `${h1}${ampm1}-${h2}${ampm2}`
}

function getColorIntensity(count: number, maxCount: number): string {
  if (count === 0) return 'bg-muted/20'
  const intensity = Math.min(count / maxCount, 1)

  if (intensity < 0.2) return 'bg-blue-500/10'
  if (intensity < 0.4) return 'bg-blue-500/20'
  if (intensity < 0.6) return 'bg-blue-500/40'
  if (intensity < 0.8) return 'bg-cyan-500/60'
  return 'bg-cyan-400/80'
}

// SVG Icon Components
const FlameIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="flameGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" stopOpacity="1" />
        <stop offset="100%" stopColor="#ef4444" stopOpacity="1" />
      </linearGradient>
      <filter id="flameGlow">
        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <path
      d="M12 2C12 2 8 6 8 10C8 13.314 9.791 16 12 16C14.209 16 16 13.314 16 10C16 6 12 2 12 2Z"
      fill="url(#flameGradient)"
      filter="url(#flameGlow)"
    />
    <path
      d="M12 22C12 22 16 18.5 16 15C16 12.239 14.209 10 12 10C9.791 10 8 12.239 8 15C8 18.5 12 22 12 22Z"
      fill="url(#flameGradient)"
      opacity="0.7"
    />
  </svg>
)

const CalendarIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="calendarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" stopOpacity="1" />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity="1" />
      </linearGradient>
      <filter id="calendarGlow">
        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect x="3" y="4" width="18" height="18" rx="2" stroke="url(#calendarGradient)" strokeWidth="2" fill="none" filter="url(#calendarGlow)"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="url(#calendarGradient)" strokeWidth="2" filter="url(#calendarGlow)"/>
    <line x1="7" y1="2" x2="7" y2="6" stroke="url(#calendarGradient)" strokeWidth="2" strokeLinecap="round" filter="url(#calendarGlow)"/>
    <line x1="17" y1="2" x2="17" y2="6" stroke="url(#calendarGradient)" strokeWidth="2" strokeLinecap="round" filter="url(#calendarGlow)"/>
  </svg>
)

const ChartIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="chartGradient" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#10b981" stopOpacity="1" />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity="1" />
      </linearGradient>
      <filter id="chartGlow">
        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <path
      d="M3 20L7 12L11 16L15 8L21 14"
      stroke="url(#chartGradient)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      filter="url(#chartGlow)"
    />
    <circle cx="7" cy="12" r="2" fill="url(#chartGradient)" filter="url(#chartGlow)"/>
    <circle cx="11" cy="16" r="2" fill="url(#chartGradient)" filter="url(#chartGlow)"/>
    <circle cx="15" cy="8" r="2" fill="url(#chartGradient)" filter="url(#chartGlow)"/>
  </svg>
)

const SearchIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="searchGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="1" />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity="1" />
      </linearGradient>
      <filter id="searchGlow">
        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <circle cx="11" cy="11" r="7" stroke="url(#searchGradient)" strokeWidth="2" fill="none" filter="url(#searchGlow)"/>
    <path d="M20 20L16 16" stroke="url(#searchGradient)" strokeWidth="2.5" strokeLinecap="round" filter="url(#searchGlow)"/>
  </svg>
)

export function ActivityHeatmap({ groupId, days = 30, onCellClick }: ActivityHeatmapProps) {
  const [heatmapData, setHeatmapData] = useState<HeatmapCell[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const fetchHeatmap = async () => {
      try {
        setLoading(true)
        const response = await fetch(API_ENDPOINTS.analyticsHeatmap(groupId, days))

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        setHeatmapData(data.heatmap || [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load heatmap')
      } finally {
        setLoading(false)
      }
    }

    fetchHeatmap()

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchHeatmap()
    }, 30000)

    return () => clearInterval(interval)
  }, [groupId, days])

  // Calculate insights
  const calculateInsights = () => {
    const hourTotals = new Map<number, number>()
    const dayTotals = new Map<number, number>()

    heatmapData.forEach((cell) => {
      hourTotals.set(cell.hour, (hourTotals.get(cell.hour) || 0) + cell.count)
      dayTotals.set(cell.dayOfWeek, (dayTotals.get(cell.dayOfWeek) || 0) + cell.count)
    })

    const peakHours: PeakHour[] = Array.from(hourTotals.entries())
      .map(([hour, count]) => ({
        timeRange: formatTimeRange(hour),
        hour,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    const busiestDays: BusiestDay[] = Array.from(dayTotals.entries())
      .map(([dayIndex, count]) => ({
        day: DAYS[dayIndex],
        dayIndex,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    const maxHourCount = Math.max(...Array.from(hourTotals.values()), 1)
    const maxDayCount = Math.max(...Array.from(dayTotals.values()), 1)
    const totalMessages = heatmapData.reduce((sum, cell) => sum + cell.count, 0)

    return { peakHours, busiestDays, maxHourCount, maxDayCount, totalMessages }
  }

  const insights = calculateInsights()
  const maxCount = Math.max(...heatmapData.map((c) => c.count), 1)

  const cellMap = new Map<string, HeatmapCell>()
  heatmapData.forEach((cell) => {
    cellMap.set(`${cell.hour}-${cell.dayOfWeek}`, cell)
  })

  if (loading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="border-b border-border/30">
          <CardTitle className="text-xl font-mono tracking-tight flex items-center gap-3">
            <ChartIcon />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Activity Patterns
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="h-[200px] flex items-center justify-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-cyan-500/20 border-t-cyan-400"></div>
              <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-xl"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="border-b border-destructive/30">
          <CardTitle className="text-xl font-mono tracking-tight text-destructive flex items-center gap-3">
            <ChartIcon />
            Activity Patterns
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="text-destructive text-sm font-mono bg-destructive/10 border border-destructive/30 rounded p-3">
            <span className="text-destructive/70">ERROR:</span> {error}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg shadow-cyan-500/5">
      <CardHeader className="border-b border-border/30 bg-gradient-to-r from-cyan-500/5 via-transparent to-blue-500/5">
        <CardTitle className="text-xl font-mono tracking-tight flex items-center gap-3">
          <ChartIcon />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Activity Patterns
          </span>
          <span className="text-sm text-muted-foreground font-normal">/ Last {days} days</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Executive Summary */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Peak Hours */}
          <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent p-4">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-amber-500/20">
              <FlameIcon />
              <h3 className="font-mono font-semibold text-sm uppercase tracking-wider text-amber-400">
                Peak Hours
              </h3>
            </div>
            <div className="space-y-2.5">
              {insights.peakHours.map((peak, idx) => {
                const percentage = (peak.count / insights.maxHourCount) * 100
                return (
                  <div key={peak.hour} className="group">
                    <div className="flex items-center gap-3">
                      <div className="w-20 text-xs font-mono text-muted-foreground tabular-nums">
                        {peak.timeRange}
                      </div>
                      <div className="flex-1 relative h-7 bg-black/30 rounded-sm overflow-hidden border border-cyan-500/20">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500/40 to-cyan-400/60 transition-all duration-500 ease-out"
                          style={{ width: `${percentage}%` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-t from-cyan-400/20 to-transparent"></div>
                        </div>
                        <div className="absolute inset-0 flex items-center px-3">
                          <span className="text-xs font-mono font-semibold text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                            {peak.count.toLocaleString()} msg
                          </span>
                        </div>
                        {idx === 0 && (
                          <div className="absolute inset-0 ring-1 ring-cyan-400/50 rounded-sm pointer-events-none"></div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Busiest Days */}
          <div className="rounded-lg border border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent p-4">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-blue-500/20">
              <CalendarIcon />
              <h3 className="font-mono font-semibold text-sm uppercase tracking-wider text-blue-400">
                Busiest Days
              </h3>
            </div>
            <div className="space-y-2.5">
              {insights.busiestDays.map((day, idx) => {
                const percentage = (day.count / insights.maxDayCount) * 100
                return (
                  <div key={day.dayIndex} className="group">
                    <div className="flex items-center gap-3">
                      <div className="w-12 text-xs font-mono text-muted-foreground">
                        {day.day}
                      </div>
                      <div className="flex-1 relative h-7 bg-black/30 rounded-sm overflow-hidden border border-blue-500/20">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500/40 to-blue-400/60 transition-all duration-500 ease-out"
                          style={{ width: `${percentage}%` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-t from-blue-400/20 to-transparent"></div>
                        </div>
                        <div className="absolute inset-0 flex items-center px-3">
                          <span className="text-xs font-mono font-semibold text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                            {day.count >= 1000 ? `${(day.count / 1000).toFixed(1)}K` : day.count}
                          </span>
                        </div>
                        {idx === 0 && (
                          <div className="absolute inset-0 ring-1 ring-blue-400/50 rounded-sm pointer-events-none"></div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Smart Insights */}
        <div className="rounded-lg border border-green-500/20 bg-gradient-to-br from-green-500/5 to-transparent p-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-green-500/20">
            <ChartIcon />
            <h3 className="font-mono font-semibold text-sm uppercase tracking-wider text-green-400">
              Weekly Pattern
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm font-mono">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-muted-foreground">Total messages:</span>
              <span className="text-foreground font-semibold tabular-nums bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                {insights.totalMessages.toLocaleString()}
              </span>
            </div>
            {insights.peakHours[0] && (
              <div className="text-sm font-mono text-muted-foreground">
                <span className="text-cyan-400">▸</span> Peak activity:{' '}
                <span className="text-cyan-400 font-medium">{insights.peakHours[0].timeRange}</span>
                {insights.busiestDays[0] && (
                  <span>
                    {' '}on <span className="text-blue-400 font-medium">{insights.busiestDays[0].day}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Detailed View Toggle */}
        <div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between p-4 rounded-lg border border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent hover:from-purple-500/10 transition-all group"
          >
            <div className="flex items-center gap-3">
              <SearchIcon />
              <h3 className="font-mono font-semibold text-sm uppercase tracking-wider text-purple-400">
                Detailed View
              </h3>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-purple-400 group-hover:translate-y-[-2px] transition-transform" />
            ) : (
              <ChevronDown className="h-5 w-5 text-purple-400 group-hover:translate-y-[2px] transition-transform" />
            )}
          </button>

          {/* Collapsible Grid */}
          {isExpanded && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border/30 bg-black/20 p-4">
              <div className="min-w-[600px]">
                <div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1">
                  {/* Header Row */}
                  <div className="h-8"></div>
                  {DAYS.map((day) => (
                    <div
                      key={day}
                      className="h-8 flex items-center justify-center text-xs font-mono font-semibold text-cyan-400/80"
                    >
                      {day}
                    </div>
                  ))}

                  {/* Hour Rows */}
                  {HOURS.map((hour) => (
                    <>
                      <div
                        key={`label-${hour}`}
                        className="h-3 flex items-center justify-end pr-2 text-[10px] font-mono text-muted-foreground tabular-nums"
                      >
                        {hour % 2 === 0 ? `${hour.toString().padStart(2, '0')}:00` : ''}
                      </div>

                      {DAYS.map((_, dayIndex) => {
                        const cell = cellMap.get(`${hour}-${dayIndex}`)
                        const count = cell?.count || 0
                        const colorClass = getColorIntensity(count, maxCount)

                        return (
                          <div
                            key={`${hour}-${dayIndex}`}
                            className={`h-3 rounded-sm cursor-pointer transition-all border border-border/30 ${colorClass} hover:ring-2 hover:ring-cyan-400/50 hover:scale-110`}
                            onClick={() => onCellClick?.(hour, dayIndex)}
                            onMouseEnter={(e) => {
                              setHoveredCell(cell || { hour, dayOfWeek: dayIndex, count: 0 })
                              setMousePosition({ x: e.clientX, y: e.clientY })
                            }}
                            onMouseMove={(e) => {
                              setMousePosition({ x: e.clientX, y: e.clientY })
                            }}
                            onMouseLeave={() => setHoveredCell(null)}
                          />
                        )
                      })}
                    </>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-border/20 text-xs font-mono">
                  <span className="text-muted-foreground">Less</span>
                  <div className="flex gap-1">
                    {[
                      'bg-muted/20',
                      'bg-blue-500/20',
                      'bg-blue-500/40',
                      'bg-cyan-500/60',
                      'bg-cyan-400/80',
                    ].map((color, i) => (
                      <div key={i} className={`h-3 w-3 rounded-sm ${color} border border-border/50`} />
                    ))}
                  </div>
                  <span className="text-muted-foreground">More</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hover Tooltip — portal to body to escape backdrop-blur stacking context */}
        {hoveredCell && hoveredCell.count > 0 && createPortal(
          <div
            className="fixed z-50 pointer-events-none bg-popover/95 backdrop-blur-sm border border-cyan-500/30 rounded-lg shadow-xl shadow-cyan-500/20 p-3 text-sm font-mono"
            style={{
              left: mousePosition.x + 10,
              top: mousePosition.y + 10,
            }}
          >
            <div className="font-semibold text-cyan-400">
              {DAYS[hoveredCell.dayOfWeek]} {hoveredCell.hour.toString().padStart(2, '0')}:00
            </div>
            <div className="text-muted-foreground mt-1 tabular-nums">
              {hoveredCell.count} message{hoveredCell.count !== 1 ? 's' : ''}
            </div>
            {hoveredCell.topTrigger && (
              <div className="text-xs text-cyan-400/80 mt-2 max-w-xs truncate border-t border-cyan-500/20 pt-2">
                <span className="text-muted-foreground">Top:</span> "{hoveredCell.topTrigger}"
              </div>
            )}
          </div>,
          document.body,
        )}
      </CardContent>
    </Card>
  )
}
