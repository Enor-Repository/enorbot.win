/**
 * Trigger Patterns Component - Terminal Aesthetic
 * Shows top 10 trigger phrases with professional SVG icons
 */
import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Plus, CheckCircle2 } from 'lucide-react'
import { TriggerPatternCreationModal } from '../rules/TriggerPatternCreationModal'
import { TriggerPatternViewEditModal } from '../rules/TriggerPatternViewEditModal'
import { ImportExport } from '../rules/ImportExport'

interface TriggerPattern {
  trigger: string
  count: number
  hasRule: boolean
  isEnabled: boolean
  ruleId: string | null
  scope?: 'all_groups' | 'control_group_only'
}

interface TriggerPatternsProps {
  groupId: string
  onCreateRule?: (trigger: string) => void
}

// SVG Icon Component
const PatternIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="patternGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a855f7" stopOpacity="1" />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity="1" />
      </linearGradient>
      <filter id="patternGlow">
        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <path
      d="M4 6h16M4 12h16M4 18h16"
      stroke="url(#patternGradient)"
      strokeWidth="2"
      strokeLinecap="round"
      filter="url(#patternGlow)"
    />
    <circle cx="8" cy="6" r="1.5" fill="url(#patternGradient)" filter="url(#patternGlow)"/>
    <circle cx="12" cy="12" r="1.5" fill="url(#patternGradient)" filter="url(#patternGlow)"/>
    <circle cx="16" cy="18" r="1.5" fill="url(#patternGradient)" filter="url(#patternGlow)"/>
  </svg>
)

export function TriggerPatterns({ groupId, onCreateRule }: TriggerPatternsProps) {
  const [patterns, setPatterns] = useState<TriggerPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedTrigger, setSelectedTrigger] = useState('')
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [viewingPattern, setViewingPattern] = useState<TriggerPattern | null>(null)

  const fetchPatterns = async () => {
    try {
      setRefreshing(true)
      const response = await fetch(
        `/api/groups/${groupId}/analytics/patterns`
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setPatterns(data.patterns || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patterns')
      console.error('Patterns fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchPatterns()

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchPatterns()
    }, 30000)

    return () => clearInterval(interval)
  }, [groupId])

  const handleCreateRule = (trigger: string) => {
    setSelectedTrigger(trigger)
    setIsModalOpen(true)
    if (onCreateRule) {
      onCreateRule(trigger)
    }
  }

  const handlePatternCreated = () => {
    // Refresh patterns to update hasRule status
    fetchPatterns()
  }

  const handleRefresh = () => {
    fetchPatterns()
  }

  const handleViewRule = (pattern: TriggerPattern) => {
    setViewingPattern(pattern)
    setIsViewModalOpen(true)
  }

  const handleRuleUpdatedOrDeleted = () => {
    // Refresh patterns to reflect changes
    fetchPatterns()
  }

  if (loading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="border-b border-border/30">
          <CardTitle className="text-xl font-mono tracking-tight flex items-center gap-3">
            <PatternIcon />
            <span className="bg-gradient-to-r from-purple-400 to-cyan-500 bg-clip-text text-transparent">
              Trigger Patterns
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="h-[200px] flex items-center justify-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-500/20 border-t-purple-400"></div>
              <div className="absolute inset-0 rounded-full bg-purple-400/10 blur-xl"></div>
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
            <PatternIcon />
            Trigger Patterns
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
    <>
      <TriggerPatternCreationModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedTrigger('')
        }}
        groupId={groupId}
        prefillTrigger={selectedTrigger}
        onPatternCreated={handlePatternCreated}
      />

      <TriggerPatternViewEditModal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false)
          setViewingPattern(null)
        }}
        trigger={viewingPattern?.trigger || ''}
        ruleId={viewingPattern?.ruleId || null}
        scope={viewingPattern?.scope}
        onPatternUpdated={handleRuleUpdatedOrDeleted}
        onPatternDeleted={handleRuleUpdatedOrDeleted}
      />

      <div className="space-y-6">
        {/* Active Trigger Patterns Section */}
        <Card className="border-green-500/30 bg-card/50 backdrop-blur-sm shadow-lg shadow-green-500/10">
          <CardHeader className="border-b border-green-500/30 bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-mono tracking-tight flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                <span className="bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
                  Active Trigger Patterns
                </span>
              </CardTitle>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedTrigger('')
                    setIsModalOpen(true)
                  }}
                  className="gap-2 font-mono text-xs border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Pattern
                </Button>
                <ImportExport groupJid={groupId} onImportComplete={handleRefresh} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="gap-2 font-mono text-xs border-green-500/30 bg-green-500/5 hover:bg-green-500/10 text-green-400"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {(() => {
              const activePatterns = patterns.filter((p) => p.hasRule && p.isEnabled)

              if (activePatterns.length === 0) {
                return (
                  <div className="text-center text-muted-foreground py-8 font-mono text-sm">
                    <div className="inline-block p-4 rounded-lg border border-green-500/20 bg-green-500/5">
                      <div className="text-green-400/70">NO ACTIVE PATTERNS</div>
                      <div className="text-xs mt-2">Create rules from suggestions below</div>
                    </div>
                  </div>
                )
              }

              return (
                <div className="space-y-2.5">
                  {activePatterns.map((pattern) => (
                    <button
                      key={pattern.trigger}
                      onClick={() => handleViewRule(pattern)}
                      className="group relative flex items-center justify-between p-4 rounded-lg border border-green-500/30 bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent hover:from-green-500/15 hover:border-green-500/40 transition-all cursor-pointer w-full text-left"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0" />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground truncate">
                              "{pattern.trigger}"
                            </span>
                            {pattern.scope === 'control_group_only' && (
                              <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[9px] px-1.5 py-0 uppercase">
                                CTRL
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground mt-1">
                            {pattern.count > 0 ? (
                              <>Detected {pattern.count} time{pattern.count !== 1 ? 's' : ''}</>
                            ) : (
                              <>Hardcoded trigger</>
                            )}
                          </div>
                        </div>

                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 font-mono font-semibold tabular-nums text-xs px-3 py-1">
                          {pattern.count}
                        </Badge>
                      </div>

                      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-green-500/0 via-green-500/5 to-green-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Suggested Patterns Section */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg shadow-purple-500/5">
          <CardHeader className="border-b border-border/30 bg-gradient-to-r from-purple-500/5 via-transparent to-cyan-500/5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-mono tracking-tight flex items-center gap-3">
                <PatternIcon />
                <span className="bg-gradient-to-r from-purple-400 to-cyan-500 bg-clip-text text-transparent">
                  Discover & Create
                </span>
                <span className="text-sm text-muted-foreground font-normal">/ Suggested patterns</span>
              </CardTitle>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {(() => {
              const suggestedPatterns = patterns.filter((p) => !p.hasRule || (p.hasRule && !p.isEnabled))

              if (suggestedPatterns.length === 0) {
                return (
                  <div className="text-center text-muted-foreground py-8 font-mono text-sm">
                    <div className="inline-block p-4 rounded-lg border border-border/30 bg-muted/10">
                      <div className="text-muted-foreground/70">NO SUGGESTIONS</div>
                      <div className="text-xs mt-2">All discovered patterns are enabled</div>
                    </div>
                  </div>
                )
              }

              return (
                <div className="space-y-2.5">
                  {suggestedPatterns.map((pattern, index) => (
                    <div
                      key={pattern.trigger}
                      className="group relative flex items-center justify-between p-4 rounded-lg border border-border/30 bg-gradient-to-r from-muted/20 via-muted/10 to-transparent hover:from-purple-500/10 hover:via-cyan-500/5 hover:border-purple-500/30 transition-all"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/30 font-mono text-xs font-bold text-purple-400 tabular-nums">
                          {(index + 1).toString().padStart(2, '0')}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground truncate">
                              "{pattern.trigger}"
                            </span>
                            {pattern.hasRule && !pattern.isEnabled && (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0">
                                DISABLED
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground mt-1">
                            Detected {pattern.count} time{pattern.count !== 1 ? 's' : ''}
                          </div>
                        </div>

                        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 font-mono font-semibold tabular-nums text-xs px-3 py-1">
                          {pattern.count}
                        </Badge>
                      </div>

                      {pattern.hasRule && !pattern.isEnabled ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCreateRule(pattern.trigger)}
                          className="ml-4 gap-2 text-xs font-mono border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 text-amber-400 flex-shrink-0"
                        >
                          Edit Pattern
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCreateRule(pattern.trigger)}
                          className="ml-4 gap-2 text-xs font-mono border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 flex-shrink-0"
                        >
                          <Plus className="h-3 w-3" />
                          Create Pattern
                        </Button>
                      )}

                      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-purple-500/0 via-purple-500/5 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
