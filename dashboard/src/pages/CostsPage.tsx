import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DollarSign, TrendingDown, AlertCircle } from 'lucide-react'

export function CostsPage() {
  // TODO: Fetch from API
  const costs = {
    today: 4.23,
    thisWeek: 28.45,
    thisMonth: 112.67,
    aiCallsToday: 142,
    avgCostPerCall: 0.0298,
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Costs & Usage</h1>
        <p className="text-muted-foreground mt-2">
          Track AI API costs and optimize spending
        </p>
      </div>

      {/* Cost Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-green-500/20 bg-gradient-to-br from-green-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today</CardTitle>
            <DollarSign className="size-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              ${costs.today.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {costs.aiCallsToday} AI calls
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <TrendingDown className="size-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-400">
              ${costs.thisWeek.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              12% lower than last week
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <DollarSign className="size-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              ${costs.thisMonth.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              On track for budget
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg per Call</CardTitle>
            <AlertCircle className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">
              ${costs.avgCostPerCall.toFixed(4)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              OpenRouter pricing
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown</CardTitle>
          <CardDescription>
            AI classification costs by model and group
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center border border-dashed rounded-lg">
            <p className="text-muted-foreground text-sm">
              Detailed cost analytics coming soon (Phase 4, Story D.10)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Budget Alerts */}
      <Card className="border-amber-500/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 text-amber-500" />
            <CardTitle>Budget Alerts</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/50">
                  Info
                </Badge>
                <span className="text-sm">Daily budget tracking not yet configured</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
