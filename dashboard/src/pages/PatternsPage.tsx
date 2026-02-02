import { TriggerPatterns } from '@/components/analytics/TriggerPatterns'

export function PatternsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Trigger Patterns</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Discover and analyze message patterns across groups
        </p>
      </div>

      {/* Trigger Patterns Component */}
      <TriggerPatterns
        groupId="all"
        onCreateRule={(trigger) => {
          if (import.meta.env.DEV) {
            console.log(`Create rule for trigger: "${trigger}"`)
          }
        }}
      />
    </div>
  )
}
