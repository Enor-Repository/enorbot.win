/**
 * Rule Tester Component - Story D.6
 * Allows testing a trigger phrase against sample messages
 * Shows match results and potential conflicts with other rules
 */
import { useState, useEffect, useRef } from 'react'
import { Play, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS } from '@/lib/api'

interface RuleTesterProps {
  triggerPhrase: string
  groupJid?: string
  ruleId?: string | null
}

interface TestResult {
  matched: boolean
  rule: {
    id: string
    trigger_phrase: string
    priority: number
  } | null
  allRules: Array<{
    id: string
    trigger_phrase: string
    priority: number
  }>
}

export function RuleTester({ triggerPhrase, groupJid = 'demo-group-id', ruleId }: RuleTesterProps) {
  const [testMessage, setTestMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cleanup on unmount - abort any pending requests
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const handleTest = async () => {
    if (!testMessage.trim()) return

    // Abort any previous request
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    setTesting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(API_ENDPOINTS.testRule, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testMessage,
          groupJid,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Test failed')
      }

      const data: TestResult = await response.json()
      setResult(data)
    } catch (err) {
      // Don't set error if request was aborted (component unmounted or new request started)
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to test rule')
    } finally {
      setTesting(false)
    }
  }

  // Check if the trigger phrase would match the test message
  const wouldCurrentTriggerMatch = testMessage.toLowerCase().includes(triggerPhrase.toLowerCase())

  // Check if another rule matched instead (potential conflict)
  // Use ruleId if available, otherwise fall back to trigger phrase comparison
  const isCurrentRuleMatch = result?.matched && result.rule && (
    (ruleId && result.rule.id === ruleId) ||
    (!ruleId && result.rule.trigger_phrase.toLowerCase() === triggerPhrase.toLowerCase())
  )
  const hasConflict = result?.matched && result.rule && !isCurrentRuleMatch

  // Check for false positive - message doesn't contain trigger but still matched this rule
  const isFalsePositive = result?.matched &&
    result.rule &&
    isCurrentRuleMatch &&
    !testMessage.toLowerCase().includes(triggerPhrase.toLowerCase())

  return (
    <div className="space-y-4 p-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
      <div className="flex items-center gap-2 text-sm font-mono font-semibold text-cyan-300">
        <Play className="h-4 w-4" />
        Test Trigger Pattern
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTest()}
          placeholder="Type a sample message to test..."
          className="flex-1 px-4 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-muted-foreground/50"
        />
        <Button
          onClick={handleTest}
          disabled={!testMessage.trim() || testing}
          className="font-mono bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 gap-2"
          variant="outline"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Test
        </Button>
      </div>

      {/* Quick match preview */}
      {testMessage && !result && (
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          {wouldCurrentTriggerMatch ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              <span>Message contains <span className="text-cyan-300">"{triggerPhrase}"</span></span>
            </>
          ) : (
            <>
              <XCircle className="h-3.5 w-3.5 text-gray-400" />
              <span>Message does not contain trigger phrase</span>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm font-mono">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Main result */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            result.matched
              ? hasConflict
                ? 'border-amber-500/30 bg-amber-500/10'
                : isFalsePositive
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-green-500/30 bg-green-500/10'
              : 'border-gray-500/30 bg-gray-500/10'
          }`}>
            {result.matched ? (
              hasConflict ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <div className="flex-1">
                    <div className="text-sm font-mono font-semibold text-amber-300">
                      Conflict Detected
                    </div>
                    <div className="text-xs font-mono text-amber-300/70 mt-0.5">
                      Another rule matched first: <span className="text-amber-200">"{result.rule?.trigger_phrase}"</span>
                      {result.rule?.priority !== undefined && (
                        <span className="ml-2">(Priority: {result.rule.priority})</span>
                      )}
                    </div>
                  </div>
                </>
              ) : isFalsePositive ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <div className="flex-1">
                    <div className="text-sm font-mono font-semibold text-red-300">
                      Potential False Positive
                    </div>
                    <div className="text-xs font-mono text-red-300/70 mt-0.5">
                      Rule matched but trigger phrase not in message
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  <div className="flex-1">
                    <div className="text-sm font-mono font-semibold text-green-300">
                      Match Found
                    </div>
                    <div className="text-xs font-mono text-green-300/70 mt-0.5">
                      This rule would be triggered
                    </div>
                  </div>
                </>
              )
            ) : (
              <>
                <XCircle className="h-5 w-5 text-gray-400" />
                <div className="flex-1">
                  <div className="text-sm font-mono font-semibold text-gray-300">
                    No Match
                  </div>
                  <div className="text-xs font-mono text-gray-400 mt-0.5">
                    No active rule would trigger for this message
                  </div>
                </div>
              </>
            )}
          </div>

          {/* All matching rules info */}
          {result.allRules.length > 0 && (
            <div className="text-xs font-mono text-muted-foreground">
              <span className="text-cyan-400">{result.allRules.length}</span> active rule{result.allRules.length !== 1 ? 's' : ''} in this group
              {result.matched && result.rule && (
                <span className="ml-2">
                  • Winner: <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{result.rule.trigger_phrase}</Badge>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] font-mono text-muted-foreground/70">
        Test how messages would be matched by your trigger patterns. Higher priority rules match first.
      </p>
    </div>
  )
}
