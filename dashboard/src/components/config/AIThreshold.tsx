/**
 * AI Threshold Slider Component - Story D.12
 *
 * Slider from 0.5 to 1.0 for confidence threshold
 * - Visual gauge shows current threshold
 * - Tooltip explains what threshold means
 * - Changes persist to group_config
 */

import { useState, useEffect } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Brain, HelpCircle, Save, RotateCcw } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AIThresholdProps {
  currentThreshold: number // 0.5 to 1.0
  onSave: (threshold: number) => Promise<void>
  disabled?: boolean
}

// Threshold descriptions for different ranges
const getThresholdInfo = (value: number): { label: string; description: string; color: string } => {
  if (value >= 0.9) {
    return {
      label: 'Very Conservative',
      description: 'Only respond when extremely confident. Most messages go to AI.',
      color: 'text-red-400',
    }
  }
  if (value >= 0.8) {
    return {
      label: 'Conservative',
      description: 'Respond only to clear patterns. Many messages use AI fallback.',
      color: 'text-amber-400',
    }
  }
  if (value >= 0.7) {
    return {
      label: 'Balanced',
      description: 'Good balance between rule matches and AI assistance.',
      color: 'text-green-400',
    }
  }
  if (value >= 0.6) {
    return {
      label: 'Moderate',
      description: 'More rule matches, but some false positives possible.',
      color: 'text-blue-400',
    }
  }
  return {
    label: 'Aggressive',
    description: 'Maximize rule matches. Higher risk of false positives.',
    color: 'text-purple-400',
  }
}

export function AIThreshold({
  currentThreshold,
  onSave,
  disabled = false,
}: AIThresholdProps) {
  const [value, setValue] = useState(currentThreshold)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Sync with prop changes
  useEffect(() => {
    setValue(currentThreshold)
    setHasChanges(false)
  }, [currentThreshold])

  const handleValueChange = (newValue: number[]) => {
    const threshold = newValue[0]
    setValue(threshold)
    // Round to 2 decimal places to avoid float precision issues
    const rounded = Math.round(threshold * 100) / 100
    const currentRounded = Math.round(currentThreshold * 100) / 100
    setHasChanges(rounded !== currentRounded)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(value)
      setHasChanges(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValue(currentThreshold)
    setHasChanges(false)
  }

  const info = getThresholdInfo(value)
  const percentage = Math.round(value * 100)

  // Calculate gauge fill percentage (0.5 = 0%, 1.0 = 100%)
  const gaugeFill = ((value - 0.5) / 0.5) * 100

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="size-5 text-cyan-500" />
            <CardTitle>AI Confidence Threshold</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  <p className="text-sm">
                    The confidence threshold determines when the bot uses rule-based responses
                    vs. AI fallback.
                  </p>
                  <ul className="mt-2 text-xs space-y-1">
                    <li>
                      <strong>Higher threshold (0.9+):</strong> More conservative, fewer false
                      positives, more AI usage
                    </li>
                    <li>
                      <strong>Lower threshold (0.5-0.6):</strong> More aggressive, more rule
                      matches, potential false positives
                    </li>
                    <li>
                      <strong>Recommended (0.7-0.8):</strong> Good balance between accuracy and
                      cost
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {hasChanges && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={isSaving}>
                <RotateCcw className="size-4 mr-1" />
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="size-4 mr-1" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>
        <CardDescription>
          Adjust how confident the bot needs to be before using rules vs. AI fallback
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visual Gauge */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Rules Priority</span>
            <span className="text-sm text-muted-foreground">AI Priority</span>
          </div>
          <div className="h-4 rounded-full bg-muted overflow-hidden relative">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-green-500 to-red-500 opacity-30" />
            {/* Fill indicator */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200"
              style={{ width: `${gaugeFill}%` }}
            />
            {/* Threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white shadow-lg transition-all duration-200"
              style={{ left: `${gaugeFill}%`, transform: 'translateX(-50%)' }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>0.50</span>
            <span>0.60</span>
            <span>0.70</span>
            <span>0.80</span>
            <span>0.90</span>
            <span>1.00</span>
          </div>
        </div>

        {/* Slider */}
        <div className="pt-2">
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5"
            value={[value]}
            onValueChange={handleValueChange}
            min={0.5}
            max={1.0}
            step={0.05}
            disabled={disabled}
          >
            <Slider.Track className="bg-muted relative grow rounded-full h-2">
              <Slider.Range className="absolute bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb
              className="block w-5 h-5 bg-white rounded-full shadow-lg border-2 border-cyan-500 hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 cursor-grab active:cursor-grabbing"
              aria-label="Confidence threshold"
            />
          </Slider.Root>
        </div>

        {/* Current Value Display */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{percentage}%</span>
              <Badge className={`${info.color} bg-opacity-20 border-current`}>
                {info.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{info.description}</p>
          </div>
        </div>

        {/* Impact Preview */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 rounded-lg border border-green-500/20 bg-green-500/5">
            <div className="font-medium text-green-400">Rule Matches</div>
            <div className="text-muted-foreground">
              {value <= 0.6 ? 'High' : value <= 0.8 ? 'Medium' : 'Low'}
            </div>
          </div>
          <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
            <div className="font-medium text-amber-400">AI Fallback</div>
            <div className="text-muted-foreground">
              {value <= 0.6 ? 'Low' : value <= 0.8 ? 'Medium' : 'High'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
