import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Sparkles } from 'lucide-react'

export function RulesPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Response Rules</h1>
          <p className="text-muted-foreground mt-2">
            Build and manage AI-powered response rules for group automation
          </p>
        </div>
        <Button>
          <Plus className="size-4" />
          New Rule
        </Button>
      </div>

      {/* Coming Soon Card */}
      <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-purple-500" />
            <CardTitle>Visual Rule Builder</CardTitle>
          </div>
          <CardDescription>
            Phase 3 feature - Build complex response rules with drag-and-drop interface
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-[300px] flex items-center justify-center border border-dashed rounded-lg">
            <div className="text-center space-y-2">
              <Sparkles className="size-12 text-purple-500 mx-auto" />
              <p className="text-muted-foreground text-sm">
                Interactive rule builder coming soon
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                Create rules based on patterns, keywords, sentiment analysis, and more.
                Rules will automatically generate responses using AI classification.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Features Preview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pattern Detection</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Identify message patterns and trigger automated responses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">AI Classification</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use AI to classify messages and route to appropriate handlers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Smart Replies</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Generate context-aware replies based on conversation history
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
