#!/usr/bin/env node
/**
 * Liqd rollout runner
 *
 * One-shot phase runner with hard gates for safe activation.
 * Usage:
 *   node scripts/liqd/rollout.mjs phase0
 *   node scripts/liqd/rollout.mjs phase5 --watch --watch-minutes=60
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ quiet: true })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..', '..')

const CONFIG = {
  liqdGroupJid: process.env.LIQD_GROUP_JID ?? '120363421013716073@g.us',
  controlGroupJid: process.env.CONTROL_GROUP_JID ?? '120363422792688813@g.us',
  testGroupJid: process.env.LIQD_TEST_GROUP_JID ?? '120363426253004498@g.us',
  liqdOperatorJid: process.env.LIQD_OPERATOR_JID ?? '155139235123265@lid',
  liqdIgnoredJid: process.env.LIQD_IGNORED_JID ?? '90414111543486@lid',
  safeVolumeRegex:
    process.env.LIQD_SAFE_VOLUME_REGEX ?? '\\d+(?:[.,]\\d+)?\\s*(?:k|mil)\\b|\\d{1,3}(?:[.,]\\d{3})+',
  updatedBy: process.env.LIQD_ROLLOUT_ACTOR ?? 'liqd-rollout-script',
  stateFile: process.env.LIQD_ROLLOUT_STATE_FILE ?? path.join(ROOT, '.liqd-rollout-state.json'),
}

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    fail(`Missing env ${key}`)
  }
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

function nowIso() {
  return new Date().toISOString()
}

function info(message, details) {
  if (details !== undefined) {
    console.log(`[liqd-rollout] ${message}`, details)
    return
  }
  console.log(`[liqd-rollout] ${message}`)
}

function warn(message, details) {
  if (details !== undefined) {
    console.warn(`[liqd-rollout] WARN: ${message}`, details)
    return
  }
  console.warn(`[liqd-rollout] WARN: ${message}`)
}

function fail(message, details) {
  if (details !== undefined) {
    console.error(`[liqd-rollout] FAIL: ${message}`, details)
  } else {
    console.error(`[liqd-rollout] FAIL: ${message}`)
  }
  process.exit(1)
}

function assertCondition(condition, message) {
  if (!condition) fail(message)
}

function loadState() {
  if (!fs.existsSync(CONFIG.stateFile)) {
    return { phases: {}, runs: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'))
  } catch {
    return { phases: {}, runs: [] }
  }
}

function saveState(state) {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2))
}

function markPhase(phaseName, summary) {
  const state = loadState()
  const ts = nowIso()
  state.phases[phaseName] = {
    completedAt: ts,
    summary,
  }
  state.runs.push({ phaseName, completedAt: ts, summary })
  saveState(state)
  info(`State written: ${CONFIG.stateFile}`)
}

function getPhaseTimestamp(phaseName) {
  const state = loadState()
  return state.phases?.[phaseName]?.completedAt ?? null
}

function parseArgs(argv) {
  const options = {
    watch: false,
    watchMinutes: 60,
  }
  for (const arg of argv) {
    if (arg === '--watch') {
      options.watch = true
    } else if (arg.startsWith('--watch-minutes=')) {
      const raw = arg.split('=')[1]
      const minutes = Number(raw)
      if (!Number.isFinite(minutes) || minutes <= 0) fail(`Invalid watch minutes: ${raw}`)
      options.watchMinutes = minutes
    } else if (arg.length > 0) {
      fail(`Unknown option: ${arg}`)
    }
  }
  return options
}

async function tableReachable(tableName) {
  const { error } = await sb.from(tableName).select('*', { count: 'exact', head: true })
  if (error) fail(`Table check failed for ${tableName}: ${error.message}`)
}

async function fetchGroupConfig(groupJid) {
  const { data, error } = await sb
    .from('group_config')
    .select('*')
    .eq('group_jid', groupJid)
    .maybeSingle()
  if (error) fail(`Failed to load group_config for ${groupJid}: ${error.message}`)
  if (!data) fail(`Missing group_config row for ${groupJid}`)
  return data
}

async function fetchAllGroupConfigs() {
  const { data, error } = await sb.from('group_config').select('*').order('group_jid', { ascending: true })
  if (error) fail(`Failed to load group_config list: ${error.message}`)
  return data || []
}

async function setAllNonLiqdPaused() {
  const { error } = await sb
    .from('group_config')
    .update({
      mode: 'paused',
      updated_by: CONFIG.updatedBy,
      updated_at: nowIso(),
    })
    .neq('group_jid', CONFIG.liqdGroupJid)
    .neq('mode', 'paused')
  if (error) fail(`Failed to pause non-Liqd groups: ${error.message}`)
}

async function activateLiqd() {
  const { error } = await sb
    .from('group_config')
    .update({
      mode: 'active',
      updated_by: CONFIG.updatedBy,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.liqdGroupJid)
  if (error) fail(`Failed to activate Liqd: ${error.message}`)
}

async function pauseLiqd(reason) {
  const { error } = await sb
    .from('group_config')
    .update({
      mode: 'paused',
      updated_by: CONFIG.updatedBy,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.liqdGroupJid)
  if (error) fail(`Failed to pause Liqd: ${error.message}`)
  warn(`Liqd paused by watchdog: ${reason}`)
}

async function setControlTriggersCommandOnly() {
  const deactivate = await sb
    .from('group_triggers')
    .update({
      is_active: false,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.controlGroupJid)
    .eq('scope', 'group')
    .eq('is_active', true)
  if (deactivate.error) fail(`Failed disabling control group-scope triggers: ${deactivate.error.message}`)

  const activate = await sb
    .from('group_triggers')
    .update({
      is_active: true,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.controlGroupJid)
    .eq('scope', 'control_only')
    .eq('is_active', false)
  if (activate.error) fail(`Failed enabling control_only triggers: ${activate.error.message}`)
}

async function getActiveControlGroupScopeTriggers() {
  const { data, error } = await sb
    .from('group_triggers')
    .select('id,action_type,trigger_phrase,scope')
    .eq('group_jid', CONFIG.controlGroupJid)
    .eq('is_active', true)
    .eq('scope', 'group')
  if (error) fail(`Failed fetching control group-scope triggers: ${error.message}`)
  return data || []
}

async function ensureLiqdRoles() {
  const row = await fetchGroupConfig(CONFIG.liqdGroupJid)
  const current = row.player_roles || {}
  const next = {
    ...current,
    [CONFIG.liqdOperatorJid]: 'operator',
    [CONFIG.liqdIgnoredJid]: 'ignore',
  }
  const { error } = await sb
    .from('group_config')
    .update({
      player_roles: next,
      updated_by: CONFIG.updatedBy,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.liqdGroupJid)
  if (error) fail(`Failed to update Liqd roles: ${error.message}`)
}

async function getActiveDealVolumeTriggers(groupJid) {
  const { data, error } = await sb
    .from('group_triggers')
    .select('id,group_jid,trigger_phrase,action_type,is_active,scope')
    .eq('group_jid', groupJid)
    .eq('action_type', 'deal_volume')
    .eq('is_active', true)
    .order('priority', { ascending: false })
  if (error) fail(`Failed loading deal_volume triggers for ${groupJid}: ${error.message}`)
  return data || []
}

async function setSafeVolumeRegexForGroup(groupJid) {
  const active = await getActiveDealVolumeTriggers(groupJid)
  if (active.length === 0) {
    fail(`No active deal_volume trigger in group ${groupJid}`)
  }
  for (const trigger of active) {
    if (trigger.trigger_phrase === CONFIG.safeVolumeRegex) {
      continue
    }
    const { error } = await sb
      .from('group_triggers')
      .update({
        trigger_phrase: CONFIG.safeVolumeRegex,
        updated_at: nowIso(),
      })
      .eq('id', trigger.id)
    if (error) {
      fail(`Failed to update trigger ${trigger.id} in ${groupJid}: ${error.message}`)
    }
  }
}

async function disableControlDealVolume() {
  const { error } = await sb
    .from('group_triggers')
    .update({
      is_active: false,
      updated_at: nowIso(),
    })
    .eq('group_jid', CONFIG.controlGroupJid)
    .eq('action_type', 'deal_volume')
    .eq('is_active', true)
  if (error) fail(`Failed to disable control deal_volume triggers: ${error.message}`)
}

async function countMessages({
  groupJid,
  isFromBot,
  messageTypeLike,
  messageTypeEq,
  sinceIso,
}) {
  let query = sb.from('messages').select('*', { count: 'exact', head: true }).eq('group_jid', groupJid)
  if (typeof isFromBot === 'boolean') query = query.eq('is_from_bot', isFromBot)
  if (messageTypeLike) query = query.like('message_type', messageTypeLike)
  if (messageTypeEq) query = query.eq('message_type', messageTypeEq)
  if (sinceIso) query = query.gte('created_at', sinceIso)
  const { count, error } = await query
  if (error) fail(`Failed counting messages: ${error.message}`)
  return count || 0
}

async function fetchMessagesSince(groupJid, sinceIso) {
  const all = []
  let from = 0
  const step = 1000
  for (let i = 0; i < 20; i++) {
    const { data, error } = await sb
      .from('messages')
      .select('created_at,is_from_bot,message_type,sender_jid,content')
      .eq('group_jid', groupJid)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + step - 1)
    if (error) fail(`Failed fetching messages for ${groupJid}: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < step) break
    from += step
  }
  return all
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`)
  }
}

function hasFilePattern(filePath, regex) {
  const full = path.join(ROOT, filePath)
  const content = fs.readFileSync(full, 'utf8')
  return regex.test(content)
}

function dateMinusMinutes(minutes) {
  const d = new Date(Date.now() - minutes * 60 * 1000)
  return d.toISOString()
}

async function assertNoMentionOnlyToDealQuoteSince(sinceIso) {
  const rows = await fetchMessagesSince(CONFIG.liqdGroupJid, sinceIso)
  const mentionOnly = /^@\d{8,}$/i
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.is_from_bot) continue
    const text = (row.content || '').trim()
    if (!mentionOnly.test(text)) continue

    const t0 = new Date(row.created_at).getTime()
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j]
      const dt = new Date(next.created_at).getTime() - t0
      if (dt > 45_000) break
      if (!next.is_from_bot) continue
      if ((next.message_type || '').startsWith('deal_')) {
        fail(
          `Mention-only message triggered deal flow in Liqd: "${text}" -> ${next.message_type} (${next.created_at})`
        )
      }
    }
  }
}

async function assertNoTemplateBurstSince(sinceIso, threshold = 3) {
  const rows = await fetchMessagesSince(CONFIG.liqdGroupJid, sinceIso)
  const bucket = new Map()
  for (const row of rows) {
    if (!row.is_from_bot) continue
    const minute = new Date(row.created_at).toISOString().slice(0, 16)
    const key = `${minute}|${row.message_type}|${(row.content || '').trim()}`
    bucket.set(key, (bucket.get(key) || 0) + 1)
  }
  for (const [key, count] of bucket.entries()) {
    if (count >= threshold) {
      fail(`Repeated bot template burst detected (${count}x): ${key}`)
    }
  }
}

async function verifyPreflight() {
  const configs = await fetchAllGroupConfigs()
  const liqd = configs.find((c) => c.group_jid === CONFIG.liqdGroupJid)
  assertCondition(!!liqd, `Liqd group not found in group_config (${CONFIG.liqdGroupJid})`)
  assertCondition(liqd.mode === 'paused', 'Liqd must be paused before activation')

  const nonLiqd = configs.filter((c) => c.group_jid !== CONFIG.liqdGroupJid)
  const nonPaused = nonLiqd.filter((c) => c.mode !== 'paused')
  assertCondition(nonPaused.length === 0, `Found non-paused non-Liqd groups: ${nonPaused.map((g) => g.group_jid).join(', ')}`)

  const activeControlGroupScope = await getActiveControlGroupScopeTriggers()
  assertCondition(activeControlGroupScope.length === 0, 'Control group has active group-scope triggers')

  const liqdDealVolume = await getActiveDealVolumeTriggers(CONFIG.liqdGroupJid)
  assertCondition(liqdDealVolume.length >= 1, 'Liqd has no active deal_volume trigger')
  for (const trigger of liqdDealVolume) {
    assertCondition(
      trigger.trigger_phrase === CONFIG.safeVolumeRegex,
      `Liqd deal_volume regex is not safe: ${trigger.trigger_phrase}`
    )
  }

  const testDealVolume = await getActiveDealVolumeTriggers(CONFIG.testGroupJid)
  assertCondition(testDealVolume.length >= 1, 'Test group has no active deal_volume trigger')
  for (const trigger of testDealVolume) {
    assertCondition(
      trigger.trigger_phrase === CONFIG.safeVolumeRegex,
      `Test group deal_volume regex is not safe: ${trigger.trigger_phrase}`
    )
  }

  const { count: liqdActiveDealsCount, error: liqdActiveDealsError } = await sb
    .from('active_deals')
    .select('*', { count: 'exact', head: true })
    .eq('group_jid', CONFIG.liqdGroupJid)
    .in('state', ['quoted', 'locked', 'awaiting_amount', 'computing'])
  if (liqdActiveDealsError) fail(`Failed checking active_deals: ${liqdActiveDealsError.message}`)
  assertCondition((liqdActiveDealsCount || 0) === 0, `Liqd has active non-terminal deals: ${liqdActiveDealsCount}`)

  const roles = liqd.player_roles || {}
  assertCondition(roles[CONFIG.liqdOperatorJid] === 'operator', 'Liqd operator role mismatch')
  assertCondition(roles[CONFIG.liqdIgnoredJid] === 'ignore', 'Liqd ignored role mismatch')

  return {
    liqdMode: liqd.mode,
    nonLiqdPaused: nonLiqd.length,
    liqdActiveDeals: liqdActiveDealsCount || 0,
  }
}

async function runWatchdog(watchMinutes) {
  info(`Starting Liqd watchdog for ${watchMinutes} minute(s)`)
  const startedAt = Date.now()
  const deadline = startedAt + watchMinutes * 60_000
  const maxBotPerMinute = 8
  const maxHintsIn10m = 3

  while (Date.now() < deadline) {
    const since1m = dateMinusMinutes(1)
    const since10m = dateMinusMinutes(10)

    const liqdBot1m = await countMessages({
      groupJid: CONFIG.liqdGroupJid,
      isFromBot: true,
      sinceIso: since1m,
    })
    if (liqdBot1m > maxBotPerMinute) {
      await pauseLiqd(`bot volume ${liqdBot1m}/min > ${maxBotPerMinute}`)
      fail('Watchdog breach: excessive bot messages in Liqd')
    }

    const liqdHints10m = await countMessages({
      groupJid: CONFIG.liqdGroupJid,
      isFromBot: true,
      messageTypeEq: 'deal_state_hint',
      sinceIso: since10m,
    })
    if (liqdHints10m > maxHintsIn10m) {
      await pauseLiqd(`operator mentions ${liqdHints10m}/10m > ${maxHintsIn10m}`)
      fail('Watchdog breach: excessive operator mentions in Liqd')
    }

    const controlDeal10m = await countMessages({
      groupJid: CONFIG.controlGroupJid,
      isFromBot: true,
      messageTypeLike: 'deal_%',
      sinceIso: since10m,
    })
    if (controlDeal10m > 0) {
      await pauseLiqd('control group produced deal_* response')
      fail('Watchdog breach: control group emitted deal_*')
    }

    await assertNoMentionOnlyToDealQuoteSince(since10m)

    info(`Watchdog ok: bot/min=${liqdBot1m}, hints/10m=${liqdHints10m}, control_deal/10m=${controlDeal10m}`)
    await new Promise((resolve) => setTimeout(resolve, 60_000))
  }

  info('Watchdog finished with no breaches')
}

async function phase0() {
  info('Phase 0: Freeze + Safety Baseline')
  await tableReachable('group_config')
  await tableReachable('group_triggers')

  await fetchGroupConfig(CONFIG.liqdGroupJid)
  await fetchGroupConfig(CONFIG.controlGroupJid)

  await setAllNonLiqdPaused()
  await setControlTriggersCommandOnly()
  await ensureLiqdRoles()

  const controlGroupScope = await getActiveControlGroupScopeTriggers()
  assertCondition(controlGroupScope.length === 0, 'Control group still has active group-scope triggers')

  const liqd = await fetchGroupConfig(CONFIG.liqdGroupJid)
  const roles = liqd.player_roles || {}
  assertCondition(roles[CONFIG.liqdOperatorJid] === 'operator', 'Liqd operator role was not set')
  assertCondition(roles[CONFIG.liqdIgnoredJid] === 'ignore', 'Liqd ignored role was not set')

  const configs = await fetchAllGroupConfigs()
  const nonLiqdNonPaused = configs.filter(
    (c) => c.group_jid !== CONFIG.liqdGroupJid && c.mode !== 'paused'
  )
  assertCondition(nonLiqdNonPaused.length === 0, 'Some non-Liqd groups are not paused')

  const summary = {
    controlGroupScopeActive: controlGroupScope.length,
    nonLiqdPaused: configs.length - 1,
    liqdRoles: {
      operator: CONFIG.liqdOperatorJid,
      ignored: CONFIG.liqdIgnoredJid,
    },
    rollbackHint:
      'Rollback: re-enable specific control triggers in dashboard if needed; keep non-Liqd groups paused.',
  }
  markPhase('phase0', summary)
  info('Phase 0 PASS', summary)
}

async function phase1() {
  info('Phase 1: Hardening Quality Gate')
  runCommand('npm', ['run', 'build'])
  runCommand('npx', [
    'vitest',
    'run',
    'src/services/dealComputation.test.ts',
    'src/services/triggerService.test.ts',
    'src/bot/router.test.ts',
    'src/handlers/deal.test.ts',
  ])

  const checks = [
    {
      file: 'src/services/triggerService.ts',
      pattern: /if \(isControlGroup && trigger\.scope !== 'control_only'\) continue/,
      message: 'Missing strict control-group scope filter in triggerService.ts',
    },
    {
      file: 'src/handlers/deal.ts',
      pattern: /UNRECOGNIZED_TAG_COOLDOWN_MS/,
      message: 'Missing operator-tag cooldown guard in deal.ts',
    },
    {
      file: 'src/handlers/deal.ts',
      pattern: /AWAITING_PROMPT_COOLDOWN_MS/,
      message: 'Missing awaiting prompt dedupe cooldown in deal.ts',
    },
    {
      file: 'src/handlers/deal.ts',
      pattern: /shouldSendExpiryOff/,
      message: 'Missing expiry off guard helper in deal.ts',
    },
  ]

  for (const check of checks) {
    if (!hasFilePattern(check.file, check.pattern)) {
      fail(check.message)
    }
  }

  const summary = {
    build: 'ok',
    tests: 'ok',
    staticChecks: checks.length,
    rollbackHint: 'Rollback: revert failing hardening commits and rerun phase1 before touching activation phases.',
  }
  markPhase('phase1', summary)
  info('Phase 1 PASS', summary)
}

async function phase2() {
  info('Phase 2: Liqd Trigger Profile')
  await tableReachable('group_triggers')

  await setSafeVolumeRegexForGroup(CONFIG.liqdGroupJid)
  await setSafeVolumeRegexForGroup(CONFIG.testGroupJid)
  await disableControlDealVolume()

  const liqd = await getActiveDealVolumeTriggers(CONFIG.liqdGroupJid)
  const test = await getActiveDealVolumeTriggers(CONFIG.testGroupJid)
  const control = await getActiveDealVolumeTriggers(CONFIG.controlGroupJid)

  assertCondition(liqd.length >= 1, 'Liqd missing active deal_volume trigger after update')
  assertCondition(test.length >= 1, 'Test group missing active deal_volume trigger after update')
  assertCondition(control.length === 0, 'Control group still has active deal_volume trigger')

  for (const trigger of [...liqd, ...test]) {
    assertCondition(
      trigger.trigger_phrase === CONFIG.safeVolumeRegex,
      `Unsafe regex remains in ${trigger.group_jid}: ${trigger.trigger_phrase}`
    )
  }

  const summary = {
    safeRegex: CONFIG.safeVolumeRegex,
    liqdTriggers: liqd.length,
    testTriggers: test.length,
    controlDealVolumeActive: control.length,
    rollbackHint:
      'Rollback: restore previous trigger_phrase values from dashboard history if needed.',
  }
  markPhase('phase2', summary)
  info('Phase 2 PASS', summary)
}

async function phase3() {
  info('Phase 3: Transcript Certification')
  const dealComputationPath = path.join(ROOT, 'dist', 'services', 'dealComputation.js')
  assertCondition(fs.existsSync(dealComputationPath), 'Build artifacts missing. Run phase1 first.')

  const moduleUrl = pathToFileURL(dealComputationPath).href
  const dealComp = await import(moduleUrl)
  const {
    extractBrlAmount,
    extractUsdtAmount,
  } = dealComp

  assertCondition(typeof extractBrlAmount === 'function', 'extractBrlAmount not available in dist build')
  assertCondition(typeof extractUsdtAmount === 'function', 'extractUsdtAmount not available in dist build')

  assertCondition(extractBrlAmount('@6202620641384') === null, 'Mention-only parsed as BRL amount')
  assertCondition(extractUsdtAmount('@6202620641384') === null, 'Mention-only parsed as USDT amount')
  assertCondition(extractBrlAmount('Off @6202620641384') === null, 'Off @mention parsed as BRL amount')
  assertCondition(
    extractUsdtAmount('Usdt 100 k quanto consegue?') === 100000,
    'USDT prefix parsing failed for "Usdt 100 k ..."'
  )

  const sinceIso = getPhaseTimestamp('phase0') ?? dateMinusMinutes(360)
  const controlDeal = await countMessages({
    groupJid: CONFIG.controlGroupJid,
    isFromBot: true,
    messageTypeLike: 'deal_%',
    sinceIso,
  })
  assertCondition(controlDeal === 0, `Control group emitted deal_* messages since ${sinceIso}`)

  await assertNoMentionOnlyToDealQuoteSince(sinceIso)
  await assertNoTemplateBurstSince(sinceIso, 3)

  const summary = {
    since: sinceIso,
    controlDealMessages: controlDeal,
    staticScenarioChecks: 4,
    rollbackHint:
      'Rollback: keep Liqd paused and fix parser/router behavior before re-running certification.',
  }
  markPhase('phase3', summary)
  info('Phase 3 PASS', summary)
}

async function phase4() {
  info('Phase 4: Production Preflight')
  const summary = await verifyPreflight()
  const snapshotPath = path.join(ROOT, 'docs', '_liqd_preflight_snapshot.json')
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        generatedAt: nowIso(),
        summary,
      },
      null,
      2
    )
  )
  markPhase('phase4', {
    ...summary,
    snapshotPath,
    rollbackHint: 'Rollback: keep Liqd paused and resolve failing preflight checks.',
  })
  info('Phase 4 PASS', summary)
}

async function phase5(options) {
  info('Phase 5: Activation + Auto Guard')
  await verifyPreflight()
  await setAllNonLiqdPaused()
  await activateLiqd()

  const configs = await fetchAllGroupConfigs()
  const liqd = configs.find((c) => c.group_jid === CONFIG.liqdGroupJid)
  assertCondition(!!liqd, 'Liqd config missing after activation')
  assertCondition(liqd.mode === 'active', 'Liqd activation failed')

  const nonPaused = configs.filter((c) => c.group_jid !== CONFIG.liqdGroupJid && c.mode !== 'paused')
  assertCondition(nonPaused.length === 0, 'Found non-Liqd groups not paused after activation')

  if (options.watch) {
    await runWatchdog(options.watchMinutes)
  }

  const summary = {
    liqdMode: liqd.mode,
    watchEnabled: options.watch,
    watchMinutes: options.watch ? options.watchMinutes : 0,
    rollbackHint: 'Rollback: set Liqd mode to paused (phase0 or control turnoff) immediately on anomalies.',
  }
  markPhase('phase5', summary)
  info('Phase 5 PASS', summary)
}

async function main() {
  const [, , command, ...rest] = process.argv
  if (!command) {
    fail('Missing command. Use: phase0|phase1|phase2|phase3|phase4|phase5')
  }
  const options = parseArgs(rest)

  switch (command) {
    case 'phase0':
      await phase0()
      break
    case 'phase1':
      await phase1()
      break
    case 'phase2':
      await phase2()
      break
    case 'phase3':
      await phase3()
      break
    case 'phase4':
      await phase4()
      break
    case 'phase5':
      await phase5(options)
      break
    default:
      fail(`Unknown command: ${command}`)
  }
}

main().catch((error) => {
  fail('Unhandled error', error instanceof Error ? error.message : String(error))
})

