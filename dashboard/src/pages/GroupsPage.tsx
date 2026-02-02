import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, Settings } from 'lucide-react'
import { PlayerLeaderboard } from '@/components/analytics/PlayerLeaderboard'

export function GroupsPage() {
  // TODO: Fetch from API
  const groups = [
    {
      id: '1',
      name: 'LIQD Trading Group',
      mode: 'learning',
      messagesCollected: 342,
      isControlGroup: false,
    },
    {
      id: '2',
      name: 'OTC CONTROLE',
      mode: 'active',
      messagesCollected: 1205,
      isControlGroup: true,
    },
    {
      id: '3',
      name: 'Crypto Signals',
      mode: 'assisted',
      messagesCollected: 567,
      isControlGroup: false,
    },
  ]

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'learning':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      case 'assisted':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/50'
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/50'
      case 'paused':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Groups</h1>
          <p className="text-muted-foreground mt-2">
            Manage group configurations and operational modes
          </p>
        </div>
        <Button>
          <Settings className="size-4" />
          Configure
        </Button>
      </div>

      {/* Groups Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <Card
            key={group.id}
            className="hover:border-primary/50 transition-colors cursor-pointer"
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Users className="size-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{group.name}</CardTitle>
                </div>
                {group.isControlGroup && (
                  <Badge variant="outline" className="text-xs">
                    Control
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Mode</span>
                <Badge className={getModeColor(group.mode)}>
                  {group.mode}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Messages</span>
                <span className="text-sm font-medium">
                  {group.messagesCollected.toLocaleString()}
                </span>
              </div>
              <Button variant="outline" size="sm" className="w-full">
                View Details
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Player Leaderboard - Demo with first group */}
      {groups.length > 0 && (
        <PlayerLeaderboard
          groupId={groups[0].id}
          limit={20}
          onRoleChange={(jid, role) => {
            console.log(`Role changed for ${jid}: ${role}`)
          }}
        />
      )}
    </div>
  )
}
