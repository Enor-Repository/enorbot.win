/**
 * Deal Computation - Brazilian Number Parsing & Deal Math
 * Sprint 4, Task 4.3
 *
 * Handles Daniel-style OTC math:
 *   R$ 4.479.100 / 5,25 = 853.161,90 USDT
 *
 * Key responsibilities:
 * - Parse Brazilian number formats (periods for thousands, commas for decimals)
 * - Compute USDT amount from BRL and rate
 * - Compute BRL amount from USDT and rate
 * - Format results in pt-BR locale for WhatsApp display
 *
 * All functions return Result<T>, never throw.
 */
import { ok, err, type Result } from '../utils/result.js'

// ============================================================================
// Types
// ============================================================================

/** Result of a deal computation */
export interface DealComputationResult {
  /** BRL amount (e.g., 4479100) */
  amountBrl: number
  /** USDT amount (e.g., 853161.90) */
  amountUsdt: number
  /** Rate used for computation */
  rate: number
  /** Human-readable computation string */
  display: string
  /** Individual formatted values for flexible message construction */
  formatted: {
    brl: string
    usdt: string
    rate: string
  }
}

// ============================================================================
// Brazilian Number Parsing
// ============================================================================

/**
 * Parse a Brazilian-format number string to a JavaScript number.
 *
 * Brazilian format uses:
 * - Period (.) as thousands separator: 4.479.100
 * - Comma (,) as decimal separator: 5,25
 *
 * Supports:
 * - "4.479.100" → 4479100
 * - "5,25" → 5.25
 * - "4.479.100,50" → 4479100.50
 * - "1000" → 1000 (plain numbers)
 * - "10k" → 10000
 * - "10mil" → 10000
 * - "1.5k" → 1500
 * - "R$ 4.479.100" → 4479100 (strips currency prefix)
 * - "853.161,90" → 853161.90
 *
 * Returns null if the string cannot be parsed as a valid positive number.
 */
export function parseBrazilianNumber(input: string): number | null {
  if (!input || typeof input !== 'string') return null

  // Strip whitespace, currency symbols, and common prefixes
  let cleaned = input.trim()
    .replace(/^R\$\s*/i, '')
    .replace(/^US\$\s*/i, '')
    .replace(/^USD\s*/i, '')
    .replace(/^BRL\s*/i, '')
    .trim()

  if (cleaned.length === 0) return null

  // Handle k/mil suffix (multiplier patterns)
  const kMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*k$/i)
  if (kMatch) {
    const numStr = kMatch[1].replace(',', '.')
    const value = parseFloat(numStr) * 1000
    return Number.isFinite(value) && value > 0 ? value : null
  }

  const milMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*mil$/i)
  if (milMatch) {
    const numStr = milMatch[1].replace(',', '.')
    const value = parseFloat(numStr) * 1000
    return Number.isFinite(value) && value > 0 ? value : null
  }

  // Determine if this is Brazilian format (has period and comma)
  const hasPeriod = cleaned.includes('.')
  const hasComma = cleaned.includes(',')

  if (hasPeriod && hasComma) {
    // Both present: period is thousands separator, comma is decimal
    // e.g., "4.479.100,50" → "4479100.50"
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (hasComma && !hasPeriod) {
    // Only comma: could be decimal separator
    // Check if comma position suggests decimal (1-2 digits after)
    const commaPos = cleaned.lastIndexOf(',')
    const afterComma = cleaned.substring(commaPos + 1)
    if (afterComma.length <= 2 && /^\d+$/.test(afterComma)) {
      // Treat as decimal: "5,25" → "5.25"
      cleaned = cleaned.replace(',', '.')
    } else if (afterComma.length === 3 && /^\d+$/.test(afterComma)) {
      // Ambiguous: "1,000" — could be thousands separator or decimal
      // In Brazilian context, 3 digits after comma = thousands separator
      cleaned = cleaned.replace(',', '')
    } else {
      // Treat as decimal by default
      cleaned = cleaned.replace(',', '.')
    }
  } else if (hasPeriod && !hasComma) {
    // Only period: check if it's a thousands separator
    // Pattern like "4.479.100" (multiple periods) = thousands separators
    const periodCount = (cleaned.match(/\./g) || []).length
    if (periodCount > 1) {
      // Multiple periods = thousands separators
      cleaned = cleaned.replace(/\./g, '')
    } else {
      // Single period: check digits after it
      const periodPos = cleaned.lastIndexOf('.')
      const afterPeriod = cleaned.substring(periodPos + 1)
      if (afterPeriod.length === 3 && /^\d+$/.test(afterPeriod)) {
        // "5.000" → thousands separator (5000)
        // But also could be "5.250" as decimal...
        // Heuristic: if before period is 1-3 digits, likely thousands separator
        const beforePeriod = cleaned.substring(0, periodPos)
        if (/^\d{1,3}$/.test(beforePeriod)) {
          cleaned = cleaned.replace('.', '')
        }
        // else treat as decimal
      }
      // else: "5.25" stays as decimal
    }
  }

  const value = parseFloat(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Extract a BRL amount from a message string.
 * Looks for patterns like "R$ 4.479.100", "4.479.100 reais", "4479100", etc.
 *
 * This is a higher-level function that scans a message for the first
 * recognizable amount. For exact parsing, use parseBrazilianNumber.
 */
export function extractBrlAmount(message: string): number | null {
  if (!message) return null

  const normalized = message.trim()

  // Pattern 1: R$ prefix followed by number
  const brlPrefixMatch = normalized.match(/R\$\s*([\d.,]+(?:\s*(?:k|mil))?)/i)
  if (brlPrefixMatch) {
    const parsed = parseBrazilianNumber(brlPrefixMatch[1])
    if (parsed !== null) return parsed
  }

  // Pattern 2: Number followed by "reais" or "brl"
  const brlSuffixMatch = normalized.match(/([\d.,]+(?:\s*(?:k|mil))?)\s*(?:reais|brl)\b/i)
  if (brlSuffixMatch) {
    const parsed = parseBrazilianNumber(brlSuffixMatch[1])
    if (parsed !== null) return parsed
  }

  // Pattern 3: Number with k/mil suffix (likely BRL in OTC context)
  const multiplierMatch = normalized.match(/([\d.,]+)\s*(?:k|mil)\b/i)
  if (multiplierMatch) {
    const parsed = parseBrazilianNumber(multiplierMatch[0])
    if (parsed !== null) return parsed
  }

  // Pattern 4: Large plain number (4+ digits) or number with thousand separators
  const numberMatch = normalized.match(/([\d]{1,3}(?:\.[\d]{3})+(?:,\d{1,2})?|[\d]{4,}(?:,\d{1,2})?)/i)
  if (numberMatch) {
    const parsed = parseBrazilianNumber(numberMatch[1])
    if (parsed !== null) return parsed
  }

  return null
}

/**
 * Extract a USDT amount from a message string.
 * Looks for patterns like "500 usdt", "500u", "US$ 500", etc.
 */
export function extractUsdtAmount(message: string): number | null {
  if (!message) return null

  const normalized = message.trim()

  // Pattern 1: Number followed by "usdt", "usd", or "u"
  const usdtMatch = normalized.match(/([\d.,]+)\s*(?:usdt|usd|u)\b/i)
  if (usdtMatch) {
    const parsed = parseBrazilianNumber(usdtMatch[1])
    if (parsed !== null) return parsed
  }

  // Pattern 2: US$ prefix
  const usdPrefixMatch = normalized.match(/US\$\s*([\d.,]+)/i)
  if (usdPrefixMatch) {
    const parsed = parseBrazilianNumber(usdPrefixMatch[1])
    if (parsed !== null) return parsed
  }

  return null
}

// ============================================================================
// Brazilian Number Formatting
// ============================================================================

/**
 * Format a number in Brazilian style for display.
 *
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "4.479.100,50")
 */
export function formatBrazilianAmount(value: number, decimals: number = 2): string {
  if (!Number.isFinite(value)) return '0,00'

  // Use Intl.NumberFormat for reliable locale formatting
  const formatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return formatter.format(value)
}

/**
 * Format a BRL amount with currency symbol.
 * e.g., 4479100.50 → "R$ 4.479.100,50"
 */
export function formatBrl(value: number, decimals: number = 2): string {
  return `R$ ${formatBrazilianAmount(value, decimals)}`
}

/**
 * Format a USDT amount with symbol.
 * e.g., 853161.90 → "853.161,90 USDT"
 */
export function formatUsdt(value: number, decimals: number = 2): string {
  return `${formatBrazilianAmount(value, decimals)} USDT`
}

/**
 * Format a rate value.
 * Rates typically use 4 decimal places in Brazilian format.
 * e.g., 5.25 → "5,2500"
 */
export function formatRate(value: number): string {
  return formatBrazilianAmount(value, 4)
}

// ============================================================================
// Deal Computation
// ============================================================================

/**
 * Compute USDT amount from BRL amount and rate.
 * Daniel-style: R$ 4.479.100 / 5,25 = 853.161,90 USDT
 *
 * @param amountBrl - BRL amount (e.g., 4479100)
 * @param rate - Exchange rate (e.g., 5.25)
 * @returns Computation result with formatted display
 */
export function computeBrlToUsdt(amountBrl: number, rate: number): Result<DealComputationResult> {
  if (!Number.isFinite(amountBrl) || amountBrl <= 0) {
    return err('BRL amount must be a positive number')
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return err('Rate must be a positive number')
  }

  const amountUsdt = amountBrl / rate

  // Truncate to 2 decimal places (don't round — matches eNor convention)
  const truncatedUsdt = Math.trunc(amountUsdt * 100) / 100

  const formatted = {
    brl: formatBrl(amountBrl),
    usdt: formatUsdt(truncatedUsdt),
    rate: formatRate(rate),
  }

  const display = `${formatted.brl} / ${formatted.rate} = ${formatted.usdt}`

  return ok({
    amountBrl,
    amountUsdt: truncatedUsdt,
    rate,
    display,
    formatted,
  })
}

/**
 * Compute BRL amount from USDT amount and rate.
 * Reverse: 853.161,90 USDT × 5,25 = R$ 4.479.099,97
 *
 * @param amountUsdt - USDT amount
 * @param rate - Exchange rate
 * @returns Computation result with formatted display
 */
export function computeUsdtToBrl(amountUsdt: number, rate: number): Result<DealComputationResult> {
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return err('USDT amount must be a positive number')
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return err('Rate must be a positive number')
  }

  const amountBrl = amountUsdt * rate

  // Truncate to 2 decimal places
  const truncatedBrl = Math.trunc(amountBrl * 100) / 100

  const formatted = {
    brl: formatBrl(truncatedBrl),
    usdt: formatUsdt(amountUsdt),
    rate: formatRate(rate),
  }

  const display = `${formatted.usdt} × ${formatted.rate} = ${formatted.brl}`

  return ok({
    amountBrl: truncatedBrl,
    amountUsdt,
    rate,
    display,
    formatted,
  })
}

/**
 * Compute a deal given any two of: amountBrl, amountUsdt, rate.
 * Determines the computation direction automatically.
 */
export function computeDeal(params: {
  amountBrl?: number
  amountUsdt?: number
  rate: number
}): Result<DealComputationResult> {
  if (!Number.isFinite(params.rate) || params.rate <= 0) {
    return err('Rate must be a positive number')
  }

  if (params.amountBrl !== undefined && params.amountBrl > 0) {
    return computeBrlToUsdt(params.amountBrl, params.rate)
  }

  if (params.amountUsdt !== undefined && params.amountUsdt > 0) {
    return computeUsdtToBrl(params.amountUsdt, params.rate)
  }

  return err('Either amountBrl or amountUsdt must be provided')
}
