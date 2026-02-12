/**
 * Default Trigger Seeder
 *
 * Seeds a group with default triggers when manually requested via the dashboard.
 * Creates human-readable "contains" triggers for keyword patterns and
 * regex triggers only where truly needed (tronscan URLs, volume patterns).
 *
 * NOT called automatically — only via the "Seed Default Triggers" button
 * or POST /api/groups/:groupJid/seed endpoint.
 */

import { getSupabase } from './supabase.js'
import { clearTriggersCache } from './triggerService.js'
import { buildSystemTriggerRows } from './systemTriggerTemplates.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Seeding
// ============================================================================

/**
 * Seed default triggers for a group.
 * Skips if the group already has ANY triggers (system or user).
 * Creates human-readable "contains" triggers from keyword patterns,
 * and regex triggers only for URL/numeric patterns.
 *
 * All seeded triggers are marked is_system=true for UI badge display
 * but are fully editable and deletable.
 *
 * @param groupJid - The group to seed default triggers for
 * @param isControlGroup - Whether this is a control group (seeds control commands)
 */
export async function seedDefaultTriggers(groupJid: string, isControlGroup = false): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  try {
    // Check if group already has ANY triggers — don't overwrite existing config
    const { data: existing, error: checkError } = await supabase
      .from('group_triggers')
      .select('id')
      .eq('group_jid', groupJid)
      .limit(1)

    if (checkError) {
      logger.error('Failed to check existing triggers', {
        event: 'seed_check_error',
        groupJid,
        error: checkError.message,
      })
      return
    }

    if (existing && existing.length > 0) {
      logger.info('Group already has triggers, skipping seed', {
        event: 'seed_skip_has_triggers',
        groupJid,
      })
      return
    }

    // Build trigger rows
    const rows = await buildSystemTriggerRows(groupJid, isControlGroup)

    if (rows.length === 0) {
      logger.warn('No default triggers to seed', {
        event: 'seed_empty_rows',
        groupJid,
      })
      return
    }

    // Insert all default triggers
    const { error: insertError } = await supabase
      .from('group_triggers')
      .upsert(rows, { onConflict: 'group_jid,trigger_phrase' })

    if (insertError) {
      logger.error('Failed to seed default triggers', {
        event: 'seed_insert_error',
        groupJid,
        error: insertError.message,
      })
      return
    }

    // Clear trigger cache so next matchTrigger reads fresh data
    clearTriggersCache(groupJid)

    logger.info('Default triggers seeded for group', {
      event: 'default_triggers_seeded',
      groupJid,
      count: rows.length,
    })
  } catch (e) {
    logger.error('Exception seeding default triggers', {
      event: 'seed_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
