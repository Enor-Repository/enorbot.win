/**
 * Group Spread Editor Component
 * Placeholder for future feature
 */
import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'

interface GroupSpreadEditorProps {
  /** Reserved for future use when spread config is implemented */
  groupJid?: string
  hideTitle?: boolean
  onCountChange?: (count: number) => void
}

export function GroupSpreadEditor({ hideTitle, onCountChange }: GroupSpreadEditorProps) {
  // Report 0 count to parent (no items in coming soon state)
  useEffect(() => {
    onCountChange?.(0)
  }, [onCountChange])

  return (
    <div className="space-y-4">
      {/* Header */}
      {!hideTitle && (
        <div className="pb-2 border-b border-amber-500/10">
          <h4 className="text-xs font-mono text-amber-400 uppercase tracking-widest flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse"></span>
            Pricing Configuration
          </h4>
        </div>
      )}

      {/* Coming Soon Placeholder */}
      <div className="text-center py-8 border border-dashed border-amber-500/30 rounded-md bg-amber-500/5">
        <Sparkles className="h-10 w-10 mx-auto mb-3 text-amber-500/50" />
        <p className="text-amber-300 text-sm font-mono font-bold tracking-wider">
          COMING SOON
        </p>
        <p className="text-amber-400/60 text-xs mt-2 max-w-[200px] mx-auto">
          New feature in development
        </p>
      </div>
    </div>
  )
}
