/**
 * Player Leaderboard Component
 * Story D.3: Sortable table showing top active players in a group
 */
import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react'

interface Player {
  jid: string
  phone: string
  pushName: string
  messageCount: number
  triggerCount: number
  role: string | null
  lastActive: string
}

interface PlayerLeaderboardProps {
  groupId: string
  limit?: number
  onRoleChange?: (playerJid: string, newRole: string) => void
}

type SortField = 'pushName' | 'messageCount' | 'triggerCount' | 'lastActive'
type SortDirection = 'asc' | 'desc'

const ROLE_OPTIONS = [
  { value: null, label: 'No Role', color: 'bg-muted/50 text-muted-foreground' },
  { value: 'buyer', label: 'Buyer', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
  { value: 'seller', label: 'Seller', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
  { value: 'trader', label: 'Trader', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
  { value: 'admin', label: 'Admin', color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  { value: 'bot', label: 'Bot', color: 'bg-red-500/20 text-red-400 border-red-500/50' },
]

export function PlayerLeaderboard({ groupId, limit = 20, onRoleChange }: PlayerLeaderboardProps) {
  const [players, setPlayers] = useState<Player[]>([])
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('messageCount')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Fetch players on mount
  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        setLoading(true)
        const response = await fetch(
          `/api/groups/${groupId}/analytics/players?limit=${limit}`
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        setPlayers(data.players || [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load players')
        console.error('Players fetch error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchPlayers()

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchPlayers()
    }, 30000)

    return () => clearInterval(interval)
  }, [groupId, limit])

  // Filter and sort players
  useEffect(() => {
    let result = [...players]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          p.pushName.toLowerCase().includes(query) ||
          p.phone.toLowerCase().includes(query)
      )
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: any = a[sortField]
      let bValue: any = b[sortField]

      // Handle date strings
      if (sortField === 'lastActive') {
        aValue = new Date(aValue).getTime()
        bValue = new Date(bValue).getTime()
      }

      // Handle strings
      if (typeof aValue === 'string' && sortField !== 'lastActive') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    setFilteredPlayers(result)
  }, [players, searchQuery, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, default to descending for counts, ascending for names
      setSortField(field)
      setSortDirection(field === 'pushName' ? 'asc' : 'desc')
    }
  }

  const handleRoleChange = (playerJid: string, newRole: string | null) => {
    // Update local state
    setPlayers((prev) =>
      prev.map((p) => (p.jid === playerJid ? { ...p, role: newRole } : p))
    )

    // Call parent callback if provided
    if (onRoleChange && newRole) {
      onRoleChange(playerJid, newRole)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 text-primary" />
    ) : (
      <ArrowDown className="h-4 w-4 text-primary" />
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Leaderboard</CardTitle>
          <CardDescription>Loading player data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Player Leaderboard</CardTitle>
          <CardDescription className="text-destructive">
            Error loading data: {error}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Player Leaderboard</CardTitle>
            <CardDescription>
              Top {limit} most active players in this group
            </CardDescription>
          </div>

          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {filteredPlayers.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {searchQuery ? 'No players match your search.' : 'No player data available.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-semibold">
                    <button
                      onClick={() => handleSort('pushName')}
                      className="flex items-center gap-2 hover:text-primary transition-colors"
                    >
                      Player
                      <SortIcon field="pushName" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-semibold">
                    <button
                      onClick={() => handleSort('messageCount')}
                      className="flex items-center gap-2 ml-auto hover:text-primary transition-colors"
                    >
                      Messages
                      <SortIcon field="messageCount" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-semibold">
                    <button
                      onClick={() => handleSort('triggerCount')}
                      className="flex items-center gap-2 ml-auto hover:text-primary transition-colors"
                    >
                      Triggers
                      <SortIcon field="triggerCount" />
                    </button>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold">Role</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold">
                    <button
                      onClick={() => handleSort('lastActive')}
                      className="flex items-center gap-2 ml-auto hover:text-primary transition-colors"
                    >
                      Last Active
                      <SortIcon field="lastActive" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((player, index) => {
                  const roleOption = ROLE_OPTIONS.find((r) => r.value === player.role) || ROLE_OPTIONS[0]

                  return (
                    <tr
                      key={player.jid}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-semibold text-sm">
                            #{index + 1}
                          </div>
                          <div>
                            <div className="font-medium">{player.pushName}</div>
                            <div className="text-xs text-muted-foreground">
                              {player.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {player.messageCount.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50">
                          {player.triggerCount}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={player.role || ''}
                          onChange={(e) =>
                            handleRoleChange(player.jid, e.target.value || null)
                          }
                          className={`px-3 py-1 rounded-full text-xs font-medium border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${roleOption.color}`}
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value || 'none'} value={option.value || ''}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right text-sm text-muted-foreground">
                        {formatDate(player.lastActive)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
          Showing {filteredPlayers.length} of {players.length} players
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      </CardContent>
    </Card>
  )
}
