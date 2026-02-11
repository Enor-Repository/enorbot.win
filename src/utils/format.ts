/**
 * Brazilian Price Formatting Utility
 *
 * Formats prices in Brazilian style:
 * - Decimal separator: comma (,)
 * - Always 4 decimal places
 * - No currency symbol (just the number)
 * - No thousands separator (not required for typical USDT prices)
 */

/**
 * Format price in Brazilian style.
 * Uses comma as decimal separator and 4 decimal places.
 * IMPORTANT: Truncates to 4 decimal places (does NOT round).
 *
 * Financial accuracy: 5.82999 → 5,8299 (not 5,8300)
 * This matches eNor's manual quoting behavior.
 *
 * @param price - Number to format (e.g., 5.823456)
 * @returns Formatted string (e.g., "5,8234")
 * @throws Error if price is NaN or Infinity
 */
export function formatBrazilianPrice(price: number): string {
  // Defensive validation - reject invalid numeric values
  if (!Number.isFinite(price)) {
    throw new Error(`Invalid price value: ${price}`)
  }

  // Truncate to 4 decimal places (not round)
  // Math.trunc removes the fractional part towards zero (works for negative numbers too)
  // Note: Floating point multiplication (price * 10_000) is reliable for typical USDT/BRL prices
  const truncated = Math.trunc(price * 10_000) / 10_000
  // Format with 4 decimal places
  const formatted = truncated.toFixed(4)
  // Replace period with comma for Brazilian format
  return formatted.replace('.', ',')
}

// =============================================================================
// Story 4.3: Time Formatting Utilities
// =============================================================================

/**
 * Format milliseconds as human-readable duration.
 * Shows seconds for durations under 1 minute.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable string (e.g., "2h 30m", "45m", "30s")
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0

  const totalSeconds = Math.floor(ms / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  return `${seconds}s`
}

/**
 * Format timestamp as relative time from now.
 *
 * @param date - The date to format (null returns "Never")
 * @returns Relative time string (e.g., "2min ago", "1h ago", "Just now")
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never'

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / (60 * 1000))

  if (diffMin < 1) return 'Just now'
  if (diffMin === 1) return '1min ago'
  if (diffMin < 60) return `${diffMin}min ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours === 1) return '1h ago'
  return `${diffHours}h ago`
}

// =============================================================================
// Commercial Dollar Formatting
// =============================================================================

/**
 * Format commercial dollar exchange rate.
 * Shows both bid and ask prices with spread.
 *
 * @param bid - Buy price (what you get when selling USD)
 * @param ask - Sell price (what you pay when buying USD)
 * @returns Formatted string (e.g., "Dólar Comercial:\nCompra: R$5,2584\nVenda: R$5,2614")
 */
export function formatCommercialDollar(bid: number, ask: number): string {
  // Defensive validation
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    throw new Error(`Invalid commercial dollar values: bid=${bid}, ask=${ask}`)
  }

  // Format with 4 decimal places and Brazilian comma separator
  const formatRate = (rate: number): string => {
    const truncated = Math.trunc(rate * 10_000) / 10_000
    return `R$${truncated.toFixed(4).replace('.', ',')}`
  }

  return `*Dólar Comercial*\nCompra: ${formatRate(bid)}\nVenda: ${formatRate(ask)}`
}
