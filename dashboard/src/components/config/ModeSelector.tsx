/**
 * Mode Selector Component - Story D.11
 *
 * Dropdown with 4 modes: learning, assisted, active, paused
 * - Confirmation dialog for "active" mode
 * - Shows current mode duration
 * - Warning if switching to active with low pattern coverage
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, BookOpen, Bot, Zap, Pause, AlertTriangle, Clock } from 'lucide-react'

export type GroupMode = 'learning' | 'assisted' | 'active' | 'paused'

interface ModeSelectorProps {
  groupName: string
  currentMode: GroupMode
  learningDays: number
  rulesActive: number
  patternCoverage?: number // 0-100, percentage of common patterns covered
  onModeChange: (newMode: GroupMode) => Promise<void>
  disabled?: boolean
}

const MODE_CONFIG: Record<GroupMode, {
  label: string
  description: string
  icon: typeof BookOpen
  color: string
  badgeClass: string
}> = {
  learning: {
    label: 'Learning',
    description: 'Observe messages and collect patterns without responding',
    icon: BookOpen,
    color: 'text-blue-400',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  },
  assisted: {
    label: 'Assisted',
    description: 'AI suggests responses, human approves before sending',
    icon: Bot,
    color: 'text-purple-400',
    badgeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  },
  active: {
    label: 'Active',
    description: 'Bot responds automatically using rules first, AI as fallback',
    icon: Zap,
    color: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/50',
  },
  paused: {
    label: 'Paused',
    description: 'Complete silence - no responses or observations',
    icon: Pause,
    color: 'text-gray-400',
    badgeClass: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
  },
}

// Minimum pattern coverage recommended before going active.
// 70% means the bot has rules covering 70% of observed trigger patterns,
// reducing reliance on AI fallback and associated costs. Below this,
// users get a warning but can still proceed if they accept higher AI costs.
const MIN_PATTERN_COVERAGE = 70

export function ModeSelector({
  groupName,
  currentMode,
  learningDays,
  rulesActive,
  patternCoverage = 0,
  onModeChange,
  disabled = false,
}: ModeSelectorProps) {
  const [isChanging, setIsChanging] = useState(false)
  const [pendingMode, setPendingMode] = useState<GroupMode | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showLowCoverageWarning, setShowLowCoverageWarning] = useState(false)

  const currentConfig = MODE_CONFIG[currentMode]
  const CurrentIcon = currentConfig.icon

  const handleModeSelect = (mode: GroupMode) => {
    if (mode === currentMode) return

    // Active mode requires confirmation
    if (mode === 'active') {
      setPendingMode(mode)
      // Check pattern coverage
      if (patternCoverage < MIN_PATTERN_COVERAGE) {
        setShowLowCoverageWarning(true)
      } else {
        setShowConfirmDialog(true)
      }
      return
    }

    // Other modes can be changed directly
    executeChange(mode)
  }

  const executeChange = async (mode: GroupMode) => {
    setIsChanging(true)
    try {
      await onModeChange(mode)
    } finally {
      setIsChanging(false)
      setPendingMode(null)
      setShowConfirmDialog(false)
      setShowLowCoverageWarning(false)
    }
  }

  const handleConfirmActive = () => {
    if (pendingMode) {
      executeChange(pendingMode)
    }
  }

  const handleProceedDespiteWarning = () => {
    setShowLowCoverageWarning(false)
    setShowConfirmDialog(true)
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled || isChanging}>
            <Button
              variant="outline"
              className={`min-w-[140px] justify-between ${isChanging ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <CurrentIcon className={`size-4 ${currentConfig.color}`} />
                <span>{currentConfig.label}</span>
              </div>
              <ChevronDown className="size-4 ml-2 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">
            {(Object.entries(MODE_CONFIG) as [GroupMode, typeof MODE_CONFIG.learning][]).map(
              ([mode, config]) => {
                const Icon = config.icon
                const isSelected = mode === currentMode
                return (
                  <DropdownMenuItem
                    key={mode}
                    onClick={() => handleModeSelect(mode)}
                    className={`flex flex-col items-start gap-1 py-3 ${isSelected ? 'bg-muted' : ''}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Icon className={`size-4 ${config.color}`} />
                      <span className="font-medium">{config.label}</span>
                      {isSelected && (
                        <Badge variant="outline" className="ml-auto text-xs">
                          Current
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground pl-6">
                      {config.description}
                    </span>
                  </DropdownMenuItem>
                )
              }
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mode duration */}
        {currentMode === 'learning' && learningDays > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            <span>{learningDays} days</span>
          </div>
        )}

        {/* Rules count */}
        {rulesActive > 0 && (
          <Badge variant="outline" className="text-xs">
            {rulesActive} rules active
          </Badge>
        )}
      </div>

      {/* Confirmation Dialog for Active Mode */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-5 text-green-400" />
              Activate Bot for {groupName}?
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p>
                Switching to <strong>Active</strong> mode will enable automatic responses.
                The bot will:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Respond to matched trigger patterns using rules</li>
                <li>Use AI classification as fallback for ambiguous messages</li>
                <li>Send real messages to the WhatsApp group</li>
              </ul>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted mt-4">
                <span className="text-sm">Pattern coverage:</span>
                <Badge
                  className={
                    patternCoverage >= 80
                      ? 'bg-green-500/20 text-green-400'
                      : patternCoverage >= 50
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                  }
                >
                  {patternCoverage}%
                </Badge>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmActive} disabled={isChanging}>
              {isChanging ? 'Activating...' : 'Confirm Activation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Low Coverage Warning Dialog */}
      <Dialog open={showLowCoverageWarning} onOpenChange={setShowLowCoverageWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="size-5" />
              Low Pattern Coverage Warning
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p>
                This group has only <strong>{patternCoverage}%</strong> pattern coverage,
                which is below the recommended minimum of <strong>{MIN_PATTERN_COVERAGE}%</strong>.
              </p>
              <p>
                Activating with low coverage means:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-amber-400">
                <li>More messages will fall back to AI classification</li>
                <li>Higher AI costs per message</li>
                <li>Potential for unexpected responses</li>
              </ul>
              <p className="text-sm">
                Consider adding more rules to common patterns before activating.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowLowCoverageWarning(false)}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleProceedDespiteWarning}
              disabled={isChanging}
            >
              Proceed Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
