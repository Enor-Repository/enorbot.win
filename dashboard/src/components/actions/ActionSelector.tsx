/**
 * Action Selector Component
 * Allows users to select and configure trigger pattern actions
 */
import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { type ActionType, ACTION_CONFIGS, validateActionParams } from '@/types/actions'

interface ActionSelectorProps {
  value: {
    type: ActionType
    params: any
  }
  onChange: (type: ActionType, params: any) => void
  disabled?: boolean
}

export function ActionSelector({ value, onChange, disabled }: ActionSelectorProps) {
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleTypeChange = (newType: ActionType) => {
    // Reset params when type changes
    let defaultParams = {}

    switch (newType) {
      case 'text_response':
        defaultParams = { template: '' }
        break
      case 'usdt_quote':
        defaultParams = { include_volume: false }
        break
      case 'commercial_dollar_quote':
        defaultParams = { spread_mode: 'normal' }
        break
      case 'ai_prompt':
        defaultParams = { prompt: '', temperature: 0.7 }
        break
      case 'custom':
        defaultParams = {}
        break
    }

    onChange(newType, defaultParams)
    setValidationError(null)
  }

  const handleParamsChange = (newParams: any) => {
    onChange(value.type, newParams)

    // Validate params
    const validation = validateActionParams(value.type, newParams)
    if (!validation.valid) {
      setValidationError(validation.error || null)
    } else {
      setValidationError(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Action Type Selector */}
      <div>
        <label className="block text-sm font-mono font-semibold text-foreground mb-2">
          Action Type <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {Object.values(ACTION_CONFIGS)
            .filter(cfg => cfg.type !== 'custom') // Hide custom for now
            .map((cfg) => {
              // Get explicit color classes based on config.color
              const getColorClasses = (color: string, isActive: boolean) => {
                if (!isActive) return 'bg-muted/20 border-border/30 hover:bg-muted/30 text-foreground'

                switch (color) {
                  case 'purple':
                    return 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                  case 'green':
                    return 'bg-green-500/20 border-green-500/50 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                  case 'blue':
                    return 'bg-blue-500/20 border-blue-500/50 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                  case 'cyan':
                    return 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                  case 'amber':
                    return 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                  default:
                    return 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                }
              }

              const isActive = value.type === cfg.type

              return (
                <button
                  key={cfg.type}
                  type="button"
                  onClick={() => handleTypeChange(cfg.type)}
                  disabled={disabled}
                  className={`
                    relative px-4 py-3 rounded-lg border font-mono text-sm transition-all text-left
                    ${getColorClasses(cfg.color, isActive)}
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg">{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        {cfg.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {cfg.description}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
        </div>
      </div>

      {/* Action Parameters */}
      <div>
        <label className="block text-sm font-mono font-semibold text-foreground mb-2">
          Action Configuration
        </label>

        {value.type === 'text_response' && (
          <div className="space-y-2">
            <textarea
              value={value.params.template || ''}
              onChange={(e) => handleParamsChange({ template: e.target.value })}
              placeholder="Enter the response message template..."
              disabled={disabled}
              rows={5}
              className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 placeholder:text-muted-foreground/50 resize-none disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground font-mono">
              The message that will be sent when this pattern triggers
            </p>
          </div>
        )}

        {value.type === 'usdt_quote' && (
          <div className="space-y-3">
            <div className="px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm font-mono text-green-300">
                ✓ Will fetch live USDT/BRL price from Binance API
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value.params.include_volume || false}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  include_volume: e.target.checked
                })}
                disabled={disabled}
                className="w-4 h-4 rounded border-border/30 bg-black/30 text-green-500 focus:ring-2 focus:ring-green-500/50 disabled:opacity-50"
              />
              <span className="text-sm font-mono text-foreground">Include 24h volume information</span>
            </label>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">
                Custom message prefix (optional)
              </label>
              <input
                type="text"
                value={value.params.custom_message_prefix || ''}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  custom_message_prefix: e.target.value
                })}
                placeholder="e.g., 'Current USDT price:'"
                disabled={disabled}
                className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {value.type === 'commercial_dollar_quote' && (
          <div className="space-y-3">
            <div className="px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm font-mono text-blue-300">
                ✓ Will fetch commercial dollar (USD/BRL) exchange rate
              </p>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-2">
                Spread mode
              </label>
              <select
                value={value.params.spread_mode || 'normal'}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  spread_mode: e.target.value
                })}
                disabled={disabled}
                className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
              >
                <option value="normal">Normal spread</option>
                <option value="tight">Tight spread</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">
                Custom message prefix (optional)
              </label>
              <input
                type="text"
                value={value.params.custom_message_prefix || ''}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  custom_message_prefix: e.target.value
                })}
                placeholder="e.g., 'Commercial dollar rate:'"
                disabled={disabled}
                className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {value.type === 'ai_prompt' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">
                AI Prompt <span className="text-red-400">*</span>
              </label>
              <textarea
                value={value.params.prompt || ''}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  prompt: e.target.value
                })}
                placeholder="Enter the prompt for AI classification..."
                disabled={disabled}
                rows={4}
                className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-muted-foreground/50 resize-none disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-muted-foreground font-mono">
                This prompt will be sent to the AI classification engine
              </p>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">
                Additional context (optional)
              </label>
              <textarea
                value={value.params.context || ''}
                onChange={(e) => handleParamsChange({
                  ...value.params,
                  context: e.target.value
                })}
                placeholder="Add any context the AI should know..."
                disabled={disabled}
                rows={2}
                className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-muted-foreground/50 resize-none disabled:opacity-50"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-mono text-muted-foreground">
                  Temperature
                </label>
                <div className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-xs font-mono font-semibold text-cyan-300 tabular-nums">
                  {(value.params.temperature || 0.7).toFixed(1)}
                </div>
              </div>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={value.params.temperature || 0.7}
                  onChange={(e) => handleParamsChange({
                    ...value.params,
                    temperature: parseFloat(e.target.value)
                  })}
                  disabled={disabled}
                  className="w-full h-2 bg-gradient-to-r from-blue-500/30 to-orange-500/30 rounded-lg appearance-none cursor-pointer disabled:opacity-50 slider-thumb"
                  style={{
                    background: `linear-gradient(to right, rgb(59 130 246 / 0.3) 0%, rgb(251 146 60 / 0.3) 100%)`
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1.5">
                <span className="text-blue-400">0.0 Precise</span>
                <span className="text-purple-400">0.5 Balanced</span>
                <span className="text-orange-400">1.0 Creative</span>
              </div>
            </div>
          </div>
        )}

        {value.type === 'custom' && (
          <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-sm font-mono text-amber-300">
              Custom actions are reserved for advanced use cases. Contact support for implementation.
            </p>
          </div>
        )}
      </div>

      {/* Validation Error */}
      {validationError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="font-mono text-sm">{validationError}</span>
        </div>
      )}
    </div>
  )
}
