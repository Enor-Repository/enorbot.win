/**
 * Tronscan Handler
 *
 * Handles Tronscan transaction links posted in OTC groups.
 * Updates the most recent Excel row for that group with the transaction hash.
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { extractTronscanTx } from '../utils/triggers.js'
import { updateOnchainTx, getLastRow } from '../services/excel.js'
import { isExcelLoggingConfigured } from '../types/config.js'
import { getConfig } from '../config.js'

/**
 * Result of handling a Tronscan link.
 */
export interface TronscanHandlerResult {
  txHash: string
  groupId: string
  rowUpdated: boolean
}

/**
 * Handle a message containing a Tronscan transaction link.
 * Extracts the transaction hash and updates the most recent Excel row for this group.
 *
 * @param context - Router context with message metadata
 * @returns Result with handler outcome
 */
export async function handleTronscanMessage(
  context: RouterContext
): Promise<Result<TronscanHandlerResult>> {
  // Extract transaction hash from message
  const txHash = extractTronscanTx(context.message)

  if (!txHash) {
    // This shouldn't happen if router correctly detected the link
    logger.warn('Tronscan handler called but no tx hash found', {
      event: 'tronscan_no_hash',
      groupId: context.groupId,
      messagePreview: context.message.substring(0, 50),
    })
    return err('No transaction hash found')
  }

  logger.info('Tronscan link detected', {
    event: 'tronscan_link_detected',
    groupId: context.groupId,
    groupName: context.groupName,
    txHash,
    sender: context.sender,
  })

  // Check if Excel logging is configured
  try {
    const config = getConfig()
    if (!isExcelLoggingConfigured(config)) {
      logger.debug('Excel not configured, skipping onchain_tx update', {
        event: 'tronscan_excel_not_configured',
        groupId: context.groupId,
      })
      return ok({
        txHash,
        groupId: context.groupId,
        rowUpdated: false,
      })
    }
  } catch {
    return ok({
      txHash,
      groupId: context.groupId,
      rowUpdated: false,
    })
  }

  // Check if we have a row recorded for this group
  const lastRow = getLastRow(context.groupId)
  if (lastRow === null) {
    logger.info('No recent quote row for group, cannot update onchain_tx', {
      event: 'tronscan_no_row',
      groupId: context.groupId,
      txHash,
    })
    return ok({
      txHash,
      groupId: context.groupId,
      rowUpdated: false,
    })
  }

  // Update the Excel row with the transaction hash
  const updateResult = await updateOnchainTx(context.groupId, txHash)

  if (!updateResult.ok) {
    logger.warn('Failed to update onchain_tx in Excel', {
      event: 'tronscan_update_failed',
      error: updateResult.error,
      groupId: context.groupId,
      txHash,
    })
    return ok({
      txHash,
      groupId: context.groupId,
      rowUpdated: false,
    })
  }

  logger.info('Onchain_tx updated successfully', {
    event: 'tronscan_update_success',
    groupId: context.groupId,
    groupName: context.groupName,
    txHash,
    rowNumber: lastRow,
  })

  return ok({
    txHash,
    groupId: context.groupId,
    rowUpdated: true,
  })
}
