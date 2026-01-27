import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock logger before importing module
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))

// Mock Supabase client
const mockSupabaseClient = vi.hoisted(() => {
  const mockSelect = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpsert = vi.fn()
  const mockEq = vi.fn()

  return {
    from: vi.fn(() => ({
      select: mockSelect.mockReturnValue(Promise.resolve({ data: [], error: null })),
      update: mockUpdate.mockReturnValue({
        eq: mockEq.mockResolvedValue({ error: null }),
      }),
      upsert: mockUpsert.mockResolvedValue({ error: null }),
    })),
    _mockSelect: mockSelect,
    _mockUpdate: mockUpdate,
    _mockUpsert: mockUpsert,
    _mockEq: mockEq,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}))

// Import after mocking
import {
  initGroupConfigs,
  getGroupConfig,
  getGroupConfigSync,
  getGroupModeSync,
  getAllGroupConfigs,
  setGroupMode,
  ensureGroupRegistered,
  addTriggerPattern,
  removeTriggerPattern,
  setPlayerRole,
  setAiThreshold,
  getGroupModeStats,
  findGroupByName,
  getGroupsByMode,
  resetGroupConfigCache,
  setGroupConfigForTesting,
  type GroupConfig,
  type GroupMode,
} from './groupConfig.js'

const mockConfig = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_KEY: 'test-key',
  DEFAULT_GROUP_MODE: 'learning' as GroupMode,
  PHONE_NUMBER: '5511999999999',
  CONTROL_GROUP_PATTERN: 'CONTROLE',
  NODE_ENV: 'test' as const,
  HEALTH_PORT: 3000,
}

describe('groupConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGroupConfigCache()
  })

  describe('initGroupConfigs', () => {
    it('loads existing configs from Supabase', async () => {
      const mockRows = [
        {
          group_jid: 'group1@g.us',
          group_name: 'OTC Brasil',
          mode: 'learning',
          trigger_patterns: ['preço'],
          response_templates: {},
          player_roles: {},
          ai_threshold: 50,
          learning_started_at: '2025-01-15T10:00:00Z',
          activated_at: null,
          updated_at: '2025-01-15T10:00:00Z',
          updated_by: null,
        },
        {
          group_jid: 'group2@g.us',
          group_name: 'OTC Europe',
          mode: 'active',
          trigger_patterns: [],
          response_templates: {},
          player_roles: {},
          ai_threshold: 30,
          learning_started_at: '2025-01-01T10:00:00Z',
          activated_at: '2025-01-10T10:00:00Z',
          updated_at: '2025-01-10T10:00:00Z',
          updated_by: 'admin@s.whatsapp.net',
        },
      ]

      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: mockRows, error: null })
      )

      const result = await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      expect(result.ok).toBe(true)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Group configs initialized',
        expect.objectContaining({
          event: 'group_config_init',
          groupCount: 2,
        })
      )

      // Verify cache is populated
      const allConfigs = await getAllGroupConfigs()
      expect(allConfigs.size).toBe(2)
      expect(allConfigs.get('group1@g.us')?.groupName).toBe('OTC Brasil')
      expect(allConfigs.get('group2@g.us')?.mode).toBe('active')
    })

    it('returns error on Supabase failure', async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: null, error: { code: 'NETWORK', message: 'Connection failed' } })
      )

      const result = await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Failed to load group configs')
      }
    })
  })

  describe('getGroupModeSync', () => {
    it('returns cached mode for known group', () => {
      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })

      expect(getGroupModeSync('group1@g.us')).toBe('active')
    })

    it('returns default mode for unknown group', () => {
      // No groups in cache
      expect(getGroupModeSync('unknown@g.us')).toBe('learning')
    })
  })

  describe('getGroupConfigSync', () => {
    it('returns config for known group', () => {
      const config: GroupConfig = {
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: ['preço'],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      }
      setGroupConfigForTesting(config)

      const result = getGroupConfigSync('group1@g.us')

      expect(result).not.toBeNull()
      expect(result?.triggerPatterns).toContain('preço')
    })

    it('returns null for unknown group', () => {
      expect(getGroupConfigSync('unknown@g.us')).toBeNull()
    })
  })

  describe('getGroupConfig', () => {
    it('returns cached config for known group', () => {
      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })

      const config = getGroupConfig('group1@g.us')

      expect(config.groupJid).toBe('group1@g.us')
      expect(config.mode).toBe('active')
    })

    it('returns default config for unknown group', () => {
      const config = getGroupConfig('unknown@g.us')

      expect(config.groupJid).toBe('unknown@g.us')
      expect(config.groupName).toBe('Unknown Group')
      expect(config.mode).toBe('learning')
    })

    it('returns a copy to prevent external mutation', () => {
      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'active',
        triggerPatterns: ['original'],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })

      const config1 = getGroupConfig('group1@g.us')
      config1.triggerPatterns.push('mutated')

      const config2 = getGroupConfig('group1@g.us')
      expect(config2.triggerPatterns).not.toContain('mutated')
      expect(config2.triggerPatterns).toContain('original')
    })
  })

  describe('setGroupMode', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      // Add a test group to cache
      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('updates mode in Supabase and cache', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      const result = await setGroupMode('group1@g.us', 'active', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(true)
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('group_config')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Group mode updated',
        expect.objectContaining({
          event: 'group_mode_set',
          groupJid: 'group1@g.us',
          mode: 'active',
        })
      )

      // Check cache was updated
      const config = getGroupConfigSync('group1@g.us')
      expect(config?.mode).toBe('active')
    })

    it('sets activatedAt when mode is active', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      await setGroupMode('group1@g.us', 'active', 'admin@s.whatsapp.net')

      const config = getGroupConfigSync('group1@g.us')
      expect(config?.activatedAt).not.toBeNull()
    })

    it('returns error on Supabase failure', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({
        error: { code: 'NETWORK', message: 'Connection failed' },
      })

      const result = await setGroupMode('group1@g.us', 'active', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Failed to set mode')
      }
    })

    it('returns error for unregistered group', async () => {
      const result = await setGroupMode('unknown@g.us', 'active', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Group not found in cache')
      }
    })

    it('returns error for invalid mode', async () => {
      const result = await setGroupMode('group1@g.us', 'invalid' as any, 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid mode')
      }
    })
  })

  describe('ensureGroupRegistered', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])
    })

    it('registers new group with default learning mode', async () => {
      mockSupabaseClient._mockUpsert.mockResolvedValueOnce({ error: null })

      const result = await ensureGroupRegistered('newgroup@g.us', 'New Group', 'sender@s.whatsapp.net')

      expect(result.ok).toBe(true)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Group registered',
        expect.objectContaining({
          event: 'group_registered',
          groupJid: 'newgroup@g.us',
          groupName: 'New Group',
          mode: 'learning',
        })
      )

      // Check cache has new group with audit trail
      const config = getGroupConfigSync('newgroup@g.us')
      expect(config).not.toBeNull()
      expect(config?.mode).toBe('learning')
      expect(config?.updatedBy).toBe('sender@s.whatsapp.net')
    })

    it('registers new group without updatedBy', async () => {
      mockSupabaseClient._mockUpsert.mockResolvedValueOnce({ error: null })

      const result = await ensureGroupRegistered('newgroup2@g.us', 'New Group 2')

      expect(result.ok).toBe(true)

      const config = getGroupConfigSync('newgroup2@g.us')
      expect(config).not.toBeNull()
      expect(config?.updatedBy).toBeNull()
    })

    it('skips registration for existing group', async () => {
      setGroupConfigForTesting({
        groupJid: 'existing@g.us',
        groupName: 'Existing Group',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })

      const result = await ensureGroupRegistered('existing@g.us', 'Existing Group')

      expect(result.ok).toBe(true)
      // Should not call upsert since group already exists
      expect(mockSupabaseClient._mockUpsert).not.toHaveBeenCalled()
    })
  })

  describe('addTriggerPattern', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: ['preço'],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('adds trigger pattern to group', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      const result = await addTriggerPattern('group1@g.us', 'cotação', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(true)

      const config = getGroupConfigSync('group1@g.us')
      expect(config?.triggerPatterns).toContain('cotação')
      expect(config?.triggerPatterns).toContain('preço')
    })

    it('rejects duplicate trigger pattern', async () => {
      const result = await addTriggerPattern('group1@g.us', 'preço', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('already exists')
      }
    })

    it('returns error for unknown group', async () => {
      const result = await addTriggerPattern('unknown@g.us', 'test', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Group not found')
      }
    })

    it('rejects empty trigger pattern', async () => {
      const result = await addTriggerPattern('group1@g.us', '   ', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('cannot be empty')
      }
    })

    it('rejects trigger pattern that is too long', async () => {
      const longPattern = 'a'.repeat(101)
      const result = await addTriggerPattern('group1@g.us', longPattern, 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('too long')
      }
    })

    it('rejects trigger pattern with control characters', async () => {
      const result = await addTriggerPattern('group1@g.us', 'test\x00pattern', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('invalid characters')
      }
    })
  })

  describe('removeTriggerPattern', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: ['preço', 'cotação'],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('removes trigger pattern from group', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      const result = await removeTriggerPattern('group1@g.us', 'preço', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(true)

      const config = getGroupConfigSync('group1@g.us')
      expect(config?.triggerPatterns).not.toContain('preço')
      expect(config?.triggerPatterns).toContain('cotação')
    })

    it('returns error for non-existent pattern', async () => {
      const result = await removeTriggerPattern('group1@g.us', 'nonexistent', 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  describe('setPlayerRole', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('sets player role', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      const result = await setPlayerRole(
        'group1@g.us',
        'player1@s.whatsapp.net',
        'operator',
        'admin@s.whatsapp.net'
      )

      expect(result.ok).toBe(true)

      const config = getGroupConfigSync('group1@g.us')
      expect(config?.playerRoles['player1@s.whatsapp.net']).toBe('operator')
    })
  })

  describe('setAiThreshold', () => {
    beforeEach(async () => {
      mockSupabaseClient._mockSelect.mockReturnValueOnce(
        Promise.resolve({ data: [], error: null })
      )
      await initGroupConfigs(mockConfig as Parameters<typeof initGroupConfigs>[0])

      setGroupConfigForTesting({
        groupJid: 'group1@g.us',
        groupName: 'Test Group',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('sets AI threshold', async () => {
      mockSupabaseClient._mockEq.mockResolvedValueOnce({ error: null })

      const result = await setAiThreshold('group1@g.us', 75, 'admin@s.whatsapp.net')

      expect(result.ok).toBe(true)

      const config = getGroupConfigSync('group1@g.us')
      expect(config?.aiThreshold).toBe(75)
    })

    it('rejects invalid threshold', async () => {
      const result = await setAiThreshold('group1@g.us', 150, 'admin@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('between 0 and 100')
      }
    })
  })

  describe('getGroupModeStats', () => {
    it('returns counts by mode', () => {
      setGroupConfigForTesting({
        groupJid: 'g1@g.us',
        groupName: 'G1',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
      setGroupConfigForTesting({
        groupJid: 'g2@g.us',
        groupName: 'G2',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
      setGroupConfigForTesting({
        groupJid: 'g3@g.us',
        groupName: 'G3',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })

      const stats = getGroupModeStats()

      expect(stats.learning).toBe(2)
      expect(stats.active).toBe(1)
      expect(stats.assisted).toBe(0)
      expect(stats.paused).toBe(0)
    })
  })

  describe('findGroupByName', () => {
    beforeEach(() => {
      setGroupConfigForTesting({
        groupJid: 'g1@g.us',
        groupName: 'OTC Brasil',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
      setGroupConfigForTesting({
        groupJid: 'g2@g.us',
        groupName: 'OTC Europe',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('finds exact match', () => {
      const result = findGroupByName('OTC Brasil')
      expect(result?.groupJid).toBe('g1@g.us')
    })

    it('finds partial match', () => {
      const result = findGroupByName('Brasil')
      expect(result?.groupJid).toBe('g1@g.us')
    })

    it('is case insensitive', () => {
      const result = findGroupByName('otc brasil')
      expect(result?.groupJid).toBe('g1@g.us')
    })

    it('returns null for no match', () => {
      const result = findGroupByName('NonExistent')
      expect(result).toBeNull()
    })
  })

  describe('getGroupsByMode', () => {
    beforeEach(() => {
      setGroupConfigForTesting({
        groupJid: 'g1@g.us',
        groupName: 'G1',
        mode: 'learning',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })
      setGroupConfigForTesting({
        groupJid: 'g2@g.us',
        groupName: 'G2',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })
    })

    it('returns groups with specified mode', () => {
      const learningGroups = getGroupsByMode('learning')
      expect(learningGroups).toHaveLength(1)
      expect(learningGroups[0].groupJid).toBe('g1@g.us')

      const activeGroups = getGroupsByMode('active')
      expect(activeGroups).toHaveLength(1)
      expect(activeGroups[0].groupJid).toBe('g2@g.us')
    })

    it('returns empty array for mode with no groups', () => {
      const pausedGroups = getGroupsByMode('paused')
      expect(pausedGroups).toHaveLength(0)
    })
  })

  describe('getAllGroupConfigs', () => {
    it('returns deep copies to prevent external mutation', async () => {
      setGroupConfigForTesting({
        groupJid: 'g1@g.us',
        groupName: 'G1',
        mode: 'learning',
        triggerPatterns: ['original'],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: null,
        updatedAt: new Date(),
        updatedBy: null,
      })

      const configs1 = await getAllGroupConfigs()
      const config1 = configs1.get('g1@g.us')!
      config1.triggerPatterns.push('mutated')

      const configs2 = await getAllGroupConfigs()
      const config2 = configs2.get('g1@g.us')!
      expect(config2.triggerPatterns).not.toContain('mutated')
      expect(config2.triggerPatterns).toContain('original')
    })
  })
})
