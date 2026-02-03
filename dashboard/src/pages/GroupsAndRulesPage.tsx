import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Plus, Trash2, Edit, X } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { GroupSpreadEditor } from '@/components/groups/GroupSpreadEditor'
import { GroupTimeRulesEditor } from '@/components/groups/GroupTimeRulesEditor'
import { GroupTriggersEditor } from '@/components/groups/GroupTriggersEditor'
import GroupDealsView from '@/components/groups/GroupDealsView'

const FETCH_TIMEOUT_MS = 10000
const MAX_TRIGGER_LENGTH = 100
const MAX_RESPONSE_LENGTH = 2000

interface Group {
  id: string
  jid: string
  name: string
  mode: 'learning' | 'active' | 'paused'
  isControlGroup: boolean
  messagesCollected: number
  learningDays: number
  rulesActive: number
  lastActivity: string | null
}

interface Rule {
  id: string
  group_jid: string
  trigger_phrase: string
  response_template: string
  is_active: boolean
  priority: number
  created_at: string
}

interface NewRuleForm {
  trigger_phrase: string
  response_template: string
  priority: number
  is_active: boolean
}

interface Player {
  jid: string
  name: string
  messageCount: number
  role: 'eNor' | 'non-eNor' | null
}

export function GroupsAndRulesPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [groupRules, setGroupRules] = useState<Record<string, Rule[]>>({})
  const [groupPlayers, setGroupPlayers] = useState<Record<string, Player[]>>({})
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingRules, setLoadingRules] = useState<Record<string, boolean>>({})
  const [loadingPlayers, setLoadingPlayers] = useState<Record<string, boolean>>({})
  const [updatingRole, setUpdatingRole] = useState<string | null>(null)
  const [addingRuleForGroup, setAddingRuleForGroup] = useState<string | null>(null)
  const [newRuleForm, setNewRuleForm] = useState<NewRuleForm>({
    trigger_phrase: '',
    response_template: '',
    priority: 1,
    is_active: true
  })
  const [savingRule, setSavingRule] = useState(false)
  const [deletingRule, setDeletingRule] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)

  // M1 Fix: Extracted form reset helper to avoid duplication
  const resetForm = useCallback(() => {
    setAddingRuleForGroup(null)
    setEditingRule(null)
    setNewRuleForm({
      trigger_phrase: '',
      response_template: '',
      priority: 1,
      is_active: true
    })
  }, [])

  const fetchGroups = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(API_ENDPOINTS.groups, {
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setGroups(data.groups || [])
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch groups:', error)
      }
      showToast({
        type: 'error',
        message: 'Failed to load groups'
      })
    } finally {
      clearTimeout(timeoutId)
      setLoadingGroups(false)
    }
  }, [])

  const fetchGroupRules = async (groupJid: string) => {
    setLoadingRules(prev => ({ ...prev, [groupJid]: true }))

    try {
      const response = await fetch(API_ENDPOINTS.groupRules(groupJid))

      if (!response.ok) {
        throw new Error('Failed to fetch rules')
      }

      const data = await response.json()
      setGroupRules(prev => ({ ...prev, [groupJid]: data.rules || [] }))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch rules:', error)
      }
      setGroupRules(prev => ({ ...prev, [groupJid]: [] }))
    } finally {
      setLoadingRules(prev => ({ ...prev, [groupJid]: false }))
    }
  }

  const fetchGroupPlayers = async (groupJid: string) => {
    setLoadingPlayers(prev => ({ ...prev, [groupJid]: true }))

    try {
      const response = await fetch(API_ENDPOINTS.groupPlayers(groupJid))

      if (!response.ok) {
        throw new Error('Failed to fetch players')
      }

      const data = await response.json()
      setGroupPlayers(prev => ({ ...prev, [groupJid]: data.players || [] }))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch players:', error)
      }
      setGroupPlayers(prev => ({ ...prev, [groupJid]: [] }))
    } finally {
      setLoadingPlayers(prev => ({ ...prev, [groupJid]: false }))
    }
  }

  const updatePlayerRole = async (groupJid: string, playerJid: string, role: 'eNor' | 'non-eNor' | null) => {
    const updateKey = `${groupJid}:${playerJid}`
    setUpdatingRole(updateKey)

    try {
      const response = await fetch(API_ENDPOINTS.playerRole(groupJid, playerJid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      if (!response.ok) {
        throw new Error('Failed to update role')
      }

      setGroupPlayers(prev => ({
        ...prev,
        [groupJid]: prev[groupJid]?.map(p =>
          p.jid === playerJid ? { ...p, role } : p
        ) || []
      }))

      showToast({
        type: 'success',
        message: role ? `Set to ${role}` : 'Role cleared'
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to update role:', error)
      }
      showToast({
        type: 'error',
        message: 'Failed to update player role'
      })
    } finally {
      setUpdatingRole(null)
    }
  }

  const createRule = async (groupJid: string) => {
    const trigger = newRuleForm.trigger_phrase.trim()
    const response_template = newRuleForm.response_template.trim()

    // M3 Fix: Add length validation
    if (!trigger || !response_template) {
      showToast({
        type: 'error',
        message: 'Trigger phrase and response are required'
      })
      return
    }

    if (trigger.length > MAX_TRIGGER_LENGTH) {
      showToast({
        type: 'error',
        message: `Trigger phrase must be ${MAX_TRIGGER_LENGTH} characters or less`
      })
      return
    }

    if (response_template.length > MAX_RESPONSE_LENGTH) {
      showToast({
        type: 'error',
        message: `Response must be ${MAX_RESPONSE_LENGTH} characters or less`
      })
      return
    }

    setSavingRule(true)

    try {
      const response = await fetch(API_ENDPOINTS.rules, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupJid: groupJid,
          triggerPhrase: trigger,
          responseTemplate: response_template,
          priority: newRuleForm.priority,
          isActive: newRuleForm.is_active
        })
      })

      // H2 Fix: Parse actual error message from response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to create rule')
      }

      showToast({
        type: 'success',
        message: 'Rule created successfully'
      })

      // M1 Fix: Use extracted resetForm helper
      resetForm()

      // Refresh rules for this group
      fetchGroupRules(groupJid)
      // Refresh groups to update rule count
      fetchGroups()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to create rule:', error)
      }
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create rule'
      })
    } finally {
      setSavingRule(false)
    }
  }

  const updateRule = async (groupJid: string, ruleId: string) => {
    const trigger = newRuleForm.trigger_phrase.trim()
    const response_template = newRuleForm.response_template.trim()

    // M3 Fix: Add length validation
    if (!trigger || !response_template) {
      showToast({
        type: 'error',
        message: 'Trigger phrase and response are required'
      })
      return
    }

    if (trigger.length > MAX_TRIGGER_LENGTH) {
      showToast({
        type: 'error',
        message: `Trigger phrase must be ${MAX_TRIGGER_LENGTH} characters or less`
      })
      return
    }

    if (response_template.length > MAX_RESPONSE_LENGTH) {
      showToast({
        type: 'error',
        message: `Response must be ${MAX_RESPONSE_LENGTH} characters or less`
      })
      return
    }

    setSavingRule(true)

    try {
      const response = await fetch(API_ENDPOINTS.rule(ruleId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerPhrase: trigger,
          responseTemplate: response_template,
          priority: newRuleForm.priority,
          isActive: newRuleForm.is_active
        })
      })

      // H2 Fix: Parse actual error message from response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to update rule')
      }

      showToast({
        type: 'success',
        message: 'Rule updated successfully'
      })

      // M1 Fix: Use extracted resetForm helper
      resetForm()

      // Refresh rules for this group
      fetchGroupRules(groupJid)
      // M2 Fix: Also refresh groups to update rule count (active/inactive change)
      fetchGroups()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to update rule:', error)
      }
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to update rule'
      })
    } finally {
      setSavingRule(false)
    }
  }

  const deleteRule = async (groupJid: string, ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return
    }

    // H1 Fix: Add loading state for delete operation
    setDeletingRule(ruleId)

    try {
      const response = await fetch(API_ENDPOINTS.rule(ruleId), {
        method: 'DELETE'
      })

      // H2 Fix: Parse actual error message from response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to delete rule')
      }

      showToast({
        type: 'success',
        message: 'Rule deleted'
      })

      // Refresh rules for this group
      fetchGroupRules(groupJid)
      // Refresh groups to update rule count
      fetchGroups()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to delete rule:', error)
      }
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete rule'
      })
    } finally {
      setDeletingRule(null)
    }
  }

  const openEditRule = (rule: Rule) => {
    setEditingRule(rule)
    setNewRuleForm({
      trigger_phrase: rule.trigger_phrase,
      response_template: rule.response_template,
      priority: rule.priority,
      is_active: rule.is_active
    })
  }

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  // H3 Fix: Close modal on Escape key press
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (addingRuleForGroup || editingRule)) {
        resetForm()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [addingRuleForGroup, editingRule, resetForm])

  const toggleGroup = (groupId: string, groupJid: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null)
    } else {
      setExpandedGroupId(groupId)

      if (!groupRules[groupJid]) {
        fetchGroupRules(groupJid)
      }

      if (!groupPlayers[groupJid]) {
        fetchGroupPlayers(groupJid)
      }
    }
  }

  const getModeColor = (mode: string) => {
    const colors = {
      learning: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      active: 'bg-green-500/20 text-green-300 border-green-500/40',
      paused: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
    }
    return colors[mode as keyof typeof colors] || colors.learning
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-4xl font-bold tracking-tight">Groups & Rules</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Manage groups and configure response rules
        </p>
      </div>

      {/* Groups List */}
      <div className="space-y-2">
        {loadingGroups ? (
          <Card className="border-purple-500/30">
            <CardContent className="p-8 text-center text-muted-foreground">
              Loading groups...
            </CardContent>
          </Card>
        ) : groups.length === 0 ? (
          <Card className="border-purple-500/30">
            <CardContent className="p-8 text-center text-muted-foreground">
              No groups found
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => {
            const isExpanded = expandedGroupId === group.id
            const rules = groupRules[group.jid] || []
            const players = groupPlayers[group.jid] || []
            const isLoadingRules = loadingRules[group.jid]
            const isLoadingPlayers = loadingPlayers[group.jid]

            return (
              <Card
                key={group.id}
                className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 via-purple-500/5 to-transparent hover:from-purple-500/10 transition-all relative overflow-hidden"
              >
                {/* Tech-y glow effect */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                {/* Group Header - Clickable */}
                <button
                  onClick={() => toggleGroup(group.id, group.jid)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-purple-500/5 transition-all duration-200 rounded-t-lg border-l-2 border-l-transparent hover:border-l-purple-400 relative"
                >
                  {/* Expand/Collapse Icon */}
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-purple-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-purple-400" />
                    )}
                  </div>

                  {/* Group Info - Single Line */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <h3 className="text-base font-mono font-semibold text-foreground truncate">
                      {group.name}
                    </h3>
                    {group.isControlGroup && (
                      <Badge className="bg-purple-500/30 text-purple-300 border-purple-500/40 text-[10px] px-1.5 py-0 uppercase">
                        CTRL
                      </Badge>
                    )}
                    <Badge className={`${getModeColor(group.mode)} text-[10px] font-mono px-1.5 py-0 uppercase`}>
                      {group.mode}
                    </Badge>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono ml-auto">
                      <span className="flex items-center gap-1">
                        <span className="text-purple-400">{group.messagesCollected}</span>
                        <span className="opacity-60">msg</span>
                      </span>
                      <span className="opacity-40">|</span>
                      <span className="flex items-center gap-1">
                        <span className="text-purple-400">{group.learningDays}</span>
                        <span className="opacity-60">d</span>
                      </span>
                      {group.rulesActive > 0 && (
                        <>
                          <span className="opacity-40">|</span>
                          <span className="flex items-center gap-1 text-green-400 font-semibold">
                            {group.rulesActive} rules
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Rules Count Badge */}
                  {group.rulesActive > 0 && (
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center shadow-[0_0_8px_rgba(34,197,94,0.3)]">
                      <span className="text-xs font-bold text-green-400">{group.rulesActive}</span>
                    </div>
                  )}
                </button>

                {/* Expanded Rules & Players Section */}
                {isExpanded && (
                  <div className="border-t border-purple-500/20 px-4 py-4 bg-gradient-to-b from-purple-500/5 to-transparent backdrop-blur-sm">
                    <div className="space-y-4">
                      {/* Rules Section */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-purple-500/10">
                          <h4 className="text-xs font-mono text-purple-400 uppercase tracking-widest flex items-center gap-2">
                            <span className="h-1 w-1 rounded-full bg-purple-400 animate-pulse"></span>
                            Response Rules
                          </h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setAddingRuleForGroup(group.jid)
                              setNewRuleForm({
                                trigger_phrase: '',
                                response_template: '',
                                priority: 1,
                                is_active: true
                              })
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-mono transition-all hover:shadow-[0_0_10px_rgba(168,85,247,0.3)]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </button>
                        </div>

                        {isLoadingRules ? (
                          <div className="text-center py-4 text-muted-foreground text-sm">
                            Loading rules...
                          </div>
                        ) : rules.length === 0 ? (
                          <div className="text-center py-4 border border-dashed border-purple-500/30 rounded-md">
                            <p className="text-muted-foreground text-xs">
                              No rules configured yet
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {rules.map((rule) => (
                              <div
                                key={rule.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-md bg-background/30 border border-purple-500/10 hover:border-purple-500/30 hover:shadow-[0_0_8px_rgba(168,85,247,0.1)] transition-all backdrop-blur-sm"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-sm font-mono font-semibold text-foreground">
                                      "{rule.trigger_phrase}"
                                    </span>
                                    {!rule.is_active && (
                                      <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/40 text-[10px] px-1 py-0">
                                        OFF
                                      </Badge>
                                    )}
                                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px] px-1 py-0">
                                      P{rule.priority}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground font-mono truncate">
                                    → {rule.response_template}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openEditRule(rule)
                                    }}
                                    className="p-1.5 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      deleteRule(group.jid, rule.id)
                                    }}
                                    disabled={deletingRule === rule.id} // H1 Fix: Disable during delete
                                    className={`p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors ${
                                      deletingRule === rule.id ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                  >
                                    <Trash2 className={`h-3.5 w-3.5 ${deletingRule === rule.id ? 'animate-pulse' : ''}`} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Players Section */}
                      <div className="space-y-3 pt-3 border-t border-cyan-500/10">
                        <div className="flex items-center justify-between pb-2 border-b border-cyan-500/10">
                          <h4 className="text-xs font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                            <span className="h-1 w-1 rounded-full bg-cyan-400 animate-pulse"></span>
                            Player Roles
                          </h4>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                            <span className="flex items-center gap-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-cyan-400"></div>
                              eNor
                            </span>
                            <span className="opacity-40">|</span>
                            <span className="flex items-center gap-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-amber-400"></div>
                              non-eNor
                            </span>
                          </div>
                        </div>

                        {isLoadingPlayers ? (
                          <div className="text-center py-4 text-muted-foreground text-sm">
                            Loading players...
                          </div>
                        ) : players.length === 0 ? (
                          <div className="text-center py-4 border border-dashed border-cyan-500/30 rounded-md">
                            <p className="text-muted-foreground text-xs">
                              No active players yet
                            </p>
                          </div>
                        ) : (
                          <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-2 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
                            {players.map((player) => {
                              const updateKey = `${group.jid}:${player.jid}`
                              const isUpdating = updatingRole === updateKey

                              return (
                                <div
                                  key={player.jid}
                                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-background/30 border border-cyan-500/10 hover:border-cyan-500/30 hover:shadow-[0_0_8px_rgba(34,211,238,0.1)] transition-all backdrop-blur-sm"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-mono font-semibold text-foreground truncate">
                                      {player.name}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {player.messageCount} msg
                                    </div>
                                  </div>

                                  {/* Role Toggle Switch */}
                                  <div className="relative inline-flex items-center bg-purple-500/10 border border-purple-500/30 rounded-lg p-0.5 w-[140px]">
                                    <button
                                      onClick={() => updatePlayerRole(group.jid, player.jid, 'eNor')}
                                      disabled={isUpdating}
                                      className={`relative z-10 flex-1 px-2 py-1 text-[10px] font-mono transition-all disabled:opacity-50 rounded-md ${
                                        player.role === 'eNor'
                                          ? 'text-cyan-300'
                                          : 'text-muted-foreground hover:text-foreground'
                                      }`}
                                    >
                                      eNor
                                    </button>
                                    <button
                                      onClick={() => updatePlayerRole(group.jid, player.jid, 'non-eNor')}
                                      disabled={isUpdating}
                                      className={`relative z-10 flex-1 px-2 py-1 text-[10px] font-mono transition-all disabled:opacity-50 rounded-md ${
                                        player.role === 'non-eNor'
                                          ? 'text-amber-300'
                                          : 'text-muted-foreground hover:text-foreground'
                                      }`}
                                    >
                                      non-eNor
                                    </button>
                                    {/* Sliding indicator */}
                                    <div
                                      className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] transition-all duration-200 rounded-md ${
                                        player.role === 'eNor'
                                          ? 'left-0.5 bg-cyan-500/30 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                          : player.role === 'non-eNor'
                                          ? 'left-[calc(50%+0.5px)] bg-amber-500/30 border border-amber-500/50 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                          : 'opacity-0'
                                      }`}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Time-Based Rules Section */}
                      <div className="space-y-3 pt-3 border-t border-blue-500/10">
                        <GroupTimeRulesEditor groupJid={group.jid} />
                      </div>

                      {/* Trigger Patterns Section */}
                      <div className="space-y-3 pt-3 border-t border-teal-500/10">
                        <GroupTriggersEditor groupJid={group.jid} />
                      </div>

                      {/* Pricing Configuration Section */}
                      <div className="space-y-3 pt-3 border-t border-amber-500/10">
                        <GroupSpreadEditor groupJid={group.jid} />
                      </div>

                      {/* Active Deals Section */}
                      <div className="space-y-3 pt-3 border-t border-emerald-500/10">
                        <GroupDealsView groupJid={group.jid} />
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      {/* Add/Edit Rule Modal */}
      {(addingRuleForGroup || editingRule) && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={resetForm} // H4 Fix: Click backdrop to close
        >
          <div
            className="bg-card border border-purple-500/30 rounded-lg shadow-lg shadow-purple-500/20 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()} // Prevent backdrop click when clicking modal
          >
            <div className="flex items-center justify-between p-4 border-b border-purple-500/20">
              <h3 className="text-lg font-mono font-semibold text-foreground">
                {editingRule ? 'Edit Rule' : 'Add Response Rule'}
              </h3>
              <button
                onClick={resetForm} // M1 Fix: Use resetForm helper
                className="p-1 rounded hover:bg-purple-500/20 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                  Trigger Phrase
                </label>
                <input
                  type="text"
                  value={newRuleForm.trigger_phrase}
                  onChange={(e) => setNewRuleForm(prev => ({ ...prev, trigger_phrase: e.target.value }))}
                  placeholder="e.g., compro, vendo, cotação"
                  className="w-full px-3 py-2 bg-background border border-purple-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                  Response Template
                </label>
                <textarea
                  value={newRuleForm.response_template}
                  onChange={(e) => setNewRuleForm(prev => ({ ...prev, response_template: e.target.value }))}
                  placeholder="e.g., Olá! Nossa cotação atual é..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-purple-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 resize-none"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                    Priority
                  </label>
                  <select
                    value={newRuleForm.priority}
                    onChange={(e) => setNewRuleForm(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 bg-background border border-purple-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-purple-500/50"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(p => (
                      <option key={p} value={p}>P{p} {p === 1 ? '(Highest)' : p === 10 ? '(Lowest)' : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRuleForm.is_active}
                      onChange={(e) => setNewRuleForm(prev => ({ ...prev, is_active: e.target.checked }))}
                      className="w-4 h-4 rounded border-purple-500/30 text-purple-500 focus:ring-purple-500/30"
                    />
                    <span className="text-sm font-mono text-muted-foreground">Active</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-purple-500/20">
              <button
                onClick={resetForm} // M1 Fix: Use resetForm helper
                className="px-4 py-2 rounded-md text-sm font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingRule) {
                    updateRule(editingRule.group_jid, editingRule.id)
                  } else if (addingRuleForGroup) {
                    createRule(addingRuleForGroup)
                  }
                }}
                disabled={savingRule || !newRuleForm.trigger_phrase.trim() || !newRuleForm.response_template.trim()}
                className="px-4 py-2 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-300 text-sm font-mono hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingRule ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
