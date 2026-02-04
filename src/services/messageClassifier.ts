/**
 * Message Classifier Module - Rules-based OTC message classification
 *
 * Story 8.1: Create Message Classifier Module
 * - Classify messages without AI (rules-based only)
 * - Extract volumes (BRL and USDT)
 * - Infer player roles from message patterns
 *
 * All classification is rules-based to minimize AI costs.
 */

import { extractVolumeBrl, hasTronscanLink } from '../utils/triggers.js'

// =============================================================================
// Constants (Issue fix: Extract magic numbers)
// =============================================================================

/**
 * Default max length for content preview.
 */
export const DEFAULT_PREVIEW_MAX_LENGTH = 100

/**
 * Minimum ratio of price_response messages to be classified as operator.
 */
export const OPERATOR_RESPONSE_RATIO_THRESHOLD = 0.3

/**
 * Minimum ratio of client-type messages to be classified as client.
 */
export const CLIENT_MESSAGE_RATIO_THRESHOLD = 0.6

/**
 * Minimum messages required for role inference.
 */
export const MIN_MESSAGES_FOR_ROLE_INFERENCE = 5

/**
 * Message types for OTC pattern classification.
 * Used to categorize messages for behavioral analysis.
 *
 * Updated 2026-01-29: Added new types based on behavioral analysis
 * See docs/behavioral-analysis.md for full pattern documentation
 */
export type OTCMessageType =
  | 'price_request'      // "preço?", "cotação", "quanto tá?", "price?", "tx pls"
  | 'price_response'     // Bot's price quote response
  | 'price_lock'         // "trava 5000" - lock amount at current rate (NEW)
  | 'volume_inquiry'     // "compro 10k", "tenho 5000 pra vender"
  | 'quote_calculation'  // "5000 * 5.23 = 26150" - operator calculation (NEW)
  | 'negotiation'        // Counter-offers, price discussion
  | 'confirmation'       // "fechado", "ok", "vamos", "fecha"
  | 'bot_command'        // "/compra", "/saldo" - commands to other bots (NEW)
  | 'bot_confirmation'   // "Compra Registrada" - other bot responses (NEW)
  | 'balance_report'     // "Saldo Atual" - balance information (NEW)
  | 'receipt'            // PDF/image receipt posted
  | 'tronscan'           // Transaction link shared
  | 'general'            // Chit-chat, greetings, unclassified

/**
 * Player roles in OTC groups.
 * Can be updated later as patterns emerge.
 */
export type PlayerRole =
  | 'operator'    // Runs the group, posts official prices
  | 'cio'         // Chief Investment Officer, makes decisions
  | 'client'      // Buys/sells USDT
  | 'unknown'     // Not yet classified

/**
 * Classification confidence level.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Result of message classification.
 */
export interface ClassificationResult {
  messageType: OTCMessageType
  triggerPattern: string | null
  volumeBrl: number | null
  volumeUsdt: number | null
  confidence: ConfidenceLevel
}

/**
 * Context for message classification.
 */
export interface ClassificationContext {
  isFromBot: boolean
  hasReceipt: boolean
  hasTronscan: boolean
  hasPriceTrigger: boolean
  inActiveThread?: boolean
}

/**
 * Pattern definitions for each message type.
 * Exported for per-group customization.
 *
 * Story 8.1 AC6: All classification is rules-based (no AI calls)
 * Updated 2026-01-29: Enhanced based on behavioral analysis
 */
export const MESSAGE_PATTERNS: Record<OTCMessageType, RegExp[]> = {
  price_request: [
    /\bpre[çc]o\b/i,
    /\bcota[çc][aã]o\b/i,
    // Note: \b doesn't work with Unicode chars, use lookahead instead
    /\bquanto\s+t[áa](?:\s|$|[?!,.])/i,
    /\bquanto\s+est[áa](?:\s|$|[?!,.])/i,
    /\bquanto\s+custa\b/i,
    /\bvalor\s+(do|da|de)?\s*(usdt|d[oó]lar)?(?:\s|$|[?!,.])/i,
    /\bqual\s+(o\s+)?pre[çc]o\b/i,
    // English patterns (behavioral analysis: OTC enor <> Lumina group uses English)
    /\bprice\s*[?？]\s*$/i,       // "price?" or "price？" (fullwidth question mark)
    /^price\s*$/i,               // Just "price" alone
    /\btx\s+pls\b/i,             // "tx pls" - rate please
    /\btx\s+please\b/i,          // "tx please"
    /\b(what|whats)\s+(the\s+)?rate\b/i, // "what's the rate"
  ],
  price_response: [
    // Bot responses typically contain price format
    /\bR\$\s*\d+[.,]\d+/i,
    /\bUSDT\/BRL[:\s]+\d+[.,]\d+/i,
    /\bcota[çc][aã]o[:\s]+\d+[.,]\d+/i,
  ],
  price_lock: [
    // "trava" is the primary OTC term for locking a price (behavioral analysis)
    /\btrava\s+(\d+[.,]?\d*)/i,           // "trava 5000", "trava 11400.34"
    /\btrava\s+(\d+[.,]?\d*)\s*por\s+favor/i, // "trava 5000 por favor"
    /^trava$/i,                            // Just "trava" alone (price lock request)
    /\block\s+(\d+[.,]?\d*)/i,             // English: "lock 5000"
  ],
  volume_inquiry: [
    // Buy patterns with volume (party-mode fix: handle 'mil' suffix)
    /\b(compro|quero\s+comprar|preciso\s+de?)\s+\d+(?:[.,]?\d+)?\s*(k|mil)?\s*(usdt?|brl|reais)?/i,
    // Sell patterns with volume (party-mode fix: handle 'mil' suffix)
    /\b(vendo|tenho|quero\s+vender)\s+\d+(?:[.,]?\d+)?\s*(k|mil)?\s*(usdt?|brl|reais)?/i,
    // Generic volume mention with currency
    /\d+\s*(k|mil|usdt|usd|brl|reais)\b/i,
  ],
  quote_calculation: [
    // Operator calculation: "5000 * 5.230 = 26,150.00 BRL"
    /\d+[.,]?\d*\s*[*×x]\s*\d+[.,]\d+\s*=\s*[\d.,]+/i,
    // Simpler format: "5000 * 5.23 = 26150"
    /\d+\s*\*\s*\d+[.,]\d+\s*=/i,
  ],
  negotiation: [
    // Counter-offer patterns
    /\b(pode\s+ser|aceita|faz\s+por|fecha\s+em|por\s+quanto)\b/i,
    /\b(melhor|menor|maior)\s+(pre[çc]o|valor)\b/i,
    /\bcontra[\s-]?proposta\b/i,
    /\b(aumenta|diminui|abaixa)\b/i,
  ],
  confirmation: [
    /\b(fechado|fechou|feito|deal|ok|vamos|bora|combinado)\b/i,
    /\b(confirmado|confirma|certo|beleza|blz)\b/i,
    /\b(pode\s+mandar|manda\s+a[ií]|envia)\b/i,
    /\b(aceito|aceitei|topado|topo)\b/i,
    // Additional patterns from behavioral analysis
    /^fecha[?]?$/i,              // "Fecha" or "Fecha?" alone
    /\bfechar\s+agora\b/i,       // "fechar agora"
    /^ok\s*obg?$/i,              // "Ok obg" pattern
  ],
  bot_command: [
    // Commands to other bots (Assistente Liqd, etc.)
    /^\/compra\b/i,              // "/compra" - register purchase
    /^\/saldo\b/i,               // "/saldo" - check balance
    /^\/saldof\b/i,              // "/saldof" - formatted balance
    /^\/[a-z]+\b/i,              // Any bot command starting with /
  ],
  bot_confirmation: [
    // Responses from other bots
    /\bcompra\s+registrada\b/i,  // "Compra Registrada"
    /\bvenda\s+registrada\b/i,   // "Venda Registrada"
    /\bopera[çc][aã]o\s+(registrada|confirmada)\b/i,
  ],
  balance_report: [
    // Balance reports
    /\bsaldo\s+atual\b/i,        // "Saldo Atual"
    /\bsaldo[:\s]+\d+/i,         // "Saldo: 60917"
    /\bbalance[:\s]+\d+/i,       // English: "Balance: 60917"
  ],
  receipt: [
    // Usually detected by attachment, but some text patterns
    /\b(comprovante|recibo|transfer[êe]ncia)\b/i,
    /\b(pix|ted|doc)\s+(enviado|feito|realizado)\b/i,
  ],
  tronscan: [
    // Detected by hasTronscanLink(), but include pattern for reference
    /tronscan\.(org|io)/i,
  ],
  general: [
    // Fallback - no specific patterns
  ],
}

/**
 * Keywords that indicate buy intent.
 */
const BUY_KEYWORDS = [
  'compro', 'comprar', 'quero', 'preciso', 'need', 'buy',
  'adquirir', 'pegar', 'queria'
]

/**
 * Keywords that indicate sell intent.
 */
const SELL_KEYWORDS = [
  'vendo', 'vender', 'tenho', 'disponível', 'sell', 'have',
  'ofereço', 'oferecendo'
]

/**
 * Extract USDT volume from message.
 * Patterns: "862 usdt", "862u", "1000 usd", "500usdt"
 *
 * Story 8.1 AC3: Volume extraction works for USDT patterns
 */
export function extractVolumeUsdt(message: string): number | null {
  const normalized = message.toLowerCase()

  const patterns = [
    // Match "Xu" or "X u" (shorthand for USDT) - must be at word boundary or end
    /(\d+(?:[.,]\d+)?)\s*u(?:\b|$)/i,
    // Match "X usdt", "X usd" (with optional space)
    /(\d+(?:[.,]\d+)?)\s*(?:usdt|usd)\b/i,
    // Match "usdt X" or "usd X" (currency before number)
    /(?:usdt|usd)\s*(\d+(?:[.,]\d+)?)\b/i,
    // Match "Xk usdt" or "X mil usdt"
    /(\d+(?:[.,]\d+)?)\s*(?:k|mil)\s*(?:usdt?|usd)\b/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match) {
      let numStr = match[1]
      // Handle Brazilian decimal separator
      numStr = numStr.replace(',', '.')

      // Check for k/mil multiplier
      const isMultiplied = /k|mil/i.test(match[0])
      const value = parseFloat(numStr) * (isMultiplied ? 1000 : 1)

      if (!isNaN(value) && value > 0) {
        return value
      }
    }
  }

  return null
}

/**
 * Find which trigger pattern matched a message.
 */
function findTriggerPattern(message: string, messageType: OTCMessageType): string | null {
  const patterns = MESSAGE_PATTERNS[messageType]
  const normalized = message.toLowerCase()

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match) {
      return match[0]
    }
  }

  return null
}

/**
 * Check if message has volume + buy/sell intent (volume inquiry).
 */
function hasVolumeIntent(message: string): boolean {
  const normalized = message.toLowerCase()
  const hasVolume = extractVolumeBrl(message) !== null || extractVolumeUsdt(message) !== null
  const hasBuyIntent = BUY_KEYWORDS.some(kw => normalized.includes(kw))
  const hasSellIntent = SELL_KEYWORDS.some(kw => normalized.includes(kw))

  return hasVolume && (hasBuyIntent || hasSellIntent)
}

/**
 * Check if message matches any pattern for a type.
 */
function matchesType(message: string, type: OTCMessageType): boolean {
  const patterns = MESSAGE_PATTERNS[type]
  if (patterns.length === 0) return false

  const normalized = message.toLowerCase()
  return patterns.some(pattern => pattern.test(normalized))
}

/**
 * Classify a message without using AI.
 * Uses keyword matching and regex patterns.
 *
 * Classification Priority (Updated 2026-01-29 based on behavioral analysis):
 * 1. isFromBot → price_response
 * 2. hasReceipt → receipt
 * 3. hasTronscan → tronscan
 * 4. Bot commands (/compra, /saldo) → bot_command
 * 5. Bot confirmations (Compra Registrada) → bot_confirmation
 * 6. Balance reports (Saldo Atual) → balance_report
 * 7. Price lock (trava 5000) → price_lock
 * 8. Quote calculation (5000 * 5.23 = 26150) → quote_calculation
 * 9. hasPriceTrigger → price_request (includes English patterns)
 * 10. hasVolumePattern + buyKeyword → volume_inquiry
 * 11. inActiveThread + hasNumber → negotiation
 * 12. confirmKeyword → confirmation
 * 13. else → general
 *
 * Story 8.1 AC1: classifyMessage() returns correct type for price requests
 * Story 8.1 AC2: Volume extraction works for BRL patterns
 * Story 8.1 AC3: Volume extraction works for USDT patterns
 * Story 8.1 AC4: Bot messages correctly classified as responses
 * Story 8.1 AC6: All classification is rules-based (no AI calls)
 */
export function classifyMessage(
  message: string,
  context: ClassificationContext
): ClassificationResult {
  const volumeBrl = extractVolumeBrl(message)
  const volumeUsdt = extractVolumeUsdt(message)

  // Priority 1: Bot messages (our bot's responses)
  if (context.isFromBot) {
    return {
      messageType: 'price_response',
      triggerPattern: null,
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 2: Receipt attachments
  if (context.hasReceipt) {
    return {
      messageType: 'receipt',
      triggerPattern: findTriggerPattern(message, 'receipt'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 3: Tronscan links
  if (context.hasTronscan || hasTronscanLink(message)) {
    return {
      messageType: 'tronscan',
      triggerPattern: null,
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 4: Bot commands (/compra, /saldo, etc.)
  if (matchesType(message, 'bot_command')) {
    return {
      messageType: 'bot_command',
      triggerPattern: findTriggerPattern(message, 'bot_command'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 5: Bot confirmations (Compra Registrada, etc.)
  if (matchesType(message, 'bot_confirmation')) {
    return {
      messageType: 'bot_confirmation',
      triggerPattern: findTriggerPattern(message, 'bot_confirmation'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 6: Balance reports (Saldo Atual)
  if (matchesType(message, 'balance_report')) {
    return {
      messageType: 'balance_report',
      triggerPattern: findTriggerPattern(message, 'balance_report'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 7: Price lock (trava 5000) - critical OTC operation
  if (matchesType(message, 'price_lock')) {
    return {
      messageType: 'price_lock',
      triggerPattern: findTriggerPattern(message, 'price_lock'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 8: Quote calculation (5000 * 5.23 = 26150) - operator response
  if (matchesType(message, 'quote_calculation')) {
    return {
      messageType: 'quote_calculation',
      triggerPattern: findTriggerPattern(message, 'quote_calculation'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 9: Price trigger keywords (includes new English patterns)
  if (context.hasPriceTrigger || matchesType(message, 'price_request')) {
    return {
      messageType: 'price_request',
      triggerPattern: findTriggerPattern(message, 'price_request'),
      volumeBrl,
      volumeUsdt,
      confidence: 'high',
    }
  }

  // Priority 10: Volume with buy/sell intent
  if (hasVolumeIntent(message)) {
    return {
      messageType: 'volume_inquiry',
      triggerPattern: findTriggerPattern(message, 'volume_inquiry'),
      volumeBrl,
      volumeUsdt,
      confidence: 'medium',
    }
  }

  // Priority 11: Negotiation (in active thread with numbers)
  if (context.inActiveThread) {
    // Check for confirmation first (higher priority within thread)
    if (matchesType(message, 'confirmation')) {
      return {
        messageType: 'confirmation',
        triggerPattern: findTriggerPattern(message, 'confirmation'),
        volumeBrl,
        volumeUsdt,
        confidence: 'medium',
      }
    }

    // Then check for negotiation
    if (matchesType(message, 'negotiation') || volumeBrl !== null || volumeUsdt !== null) {
      return {
        messageType: 'negotiation',
        triggerPattern: findTriggerPattern(message, 'negotiation'),
        volumeBrl,
        volumeUsdt,
        confidence: 'medium',
      }
    }
  }

  // Priority 12: Standalone confirmation (outside thread)
  if (matchesType(message, 'confirmation')) {
    return {
      messageType: 'confirmation',
      triggerPattern: findTriggerPattern(message, 'confirmation'),
      volumeBrl,
      volumeUsdt,
      confidence: 'low', // Lower confidence without thread context
    }
  }

  // Priority 13: General (fallback)
  return {
    messageType: 'general',
    triggerPattern: null,
    volumeBrl,
    volumeUsdt,
    confidence: 'low',
  }
}

/**
 * Message history entry for role inference.
 */
export interface MessageHistoryEntry {
  content: string
  messageType: OTCMessageType
}

/**
 * Attempt to infer player role from message history.
 * Returns 'unknown' if insufficient data.
 *
 * Heuristics (Updated 2026-01-29 based on behavioral analysis):
 * - operator: Sends quote_calculations, price_response, tronscan links
 * - client: Sends price_lock, price_request, volume_inquiry, bot_command
 * - bot: Sends bot_confirmation, balance_report
 * - cio: Mentioned in high-value (> 50k BRL) confirmations (future)
 * - unknown: Default until pattern emerges
 *
 * Story 8.1 AC5: inferPlayerRole() returns 'operator' for frequent price responders
 */
export function inferPlayerRole(params: {
  playerJid: string
  groupId: string
  recentMessages: MessageHistoryEntry[]
}): PlayerRole {
  const { recentMessages } = params

  // Need minimum messages for inference (Issue fix: use constant)
  if (recentMessages.length < MIN_MESSAGES_FOR_ROLE_INFERENCE) {
    return 'unknown'
  }

  const totalMessages = recentMessages.length
  const messageTypeCounts: Record<OTCMessageType, number> = {
    price_request: 0,
    price_response: 0,
    price_lock: 0,
    volume_inquiry: 0,
    quote_calculation: 0,
    negotiation: 0,
    confirmation: 0,
    bot_command: 0,
    bot_confirmation: 0,
    balance_report: 0,
    receipt: 0,
    tronscan: 0,
    general: 0,
  }

  for (const msg of recentMessages) {
    messageTypeCounts[msg.messageType]++
  }

  // Check for operator pattern: sends calculations, prices, and tronscan links
  const operatorMessageCount =
    messageTypeCounts.price_response +
    messageTypeCounts.quote_calculation +
    messageTypeCounts.tronscan
  const operatorRatio = operatorMessageCount / totalMessages
  if (operatorRatio > OPERATOR_RESPONSE_RATIO_THRESHOLD) {
    return 'operator'
  }

  // Check for client pattern: sends locks, requests, inquiries, and bot commands
  const clientMessageCount =
    messageTypeCounts.price_request +
    messageTypeCounts.price_lock +
    messageTypeCounts.volume_inquiry +
    messageTypeCounts.bot_command +
    messageTypeCounts.confirmation
  const clientRatio = clientMessageCount / totalMessages
  if (clientRatio > CLIENT_MESSAGE_RATIO_THRESHOLD) {
    return 'client'
  }

  // CIO detection requires high-value transaction context (future enhancement)
  // For now, return unknown
  return 'unknown'
}

/**
 * Get first N characters of a string for preview.
 * Truncates at word boundary if possible.
 * Issue fix: Use named constant for default max length.
 */
export function getContentPreview(content: string, maxLength: number = DEFAULT_PREVIEW_MAX_LENGTH): string {
  if (content.length <= maxLength) {
    return content
  }

  // Try to truncate at word boundary
  const truncated = content.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + '...'
  }

  return truncated + '...'
}
