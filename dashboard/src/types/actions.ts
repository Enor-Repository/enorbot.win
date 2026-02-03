/**
 * Action Type System for Trigger Patterns
 * Defines available actions that can be executed when a pattern triggers
 */

export type ActionType =
  | 'text_response'           // Simple text template response
  | 'price_quote'             // Rule-aware price quote (uses active rule's source + spread)
  | 'volume_quote'            // Rule-aware volume calculation (extracts amount, applies rule pricing)
  | 'usdt_quote'              // Get USDT/BRL price quote (legacy, kept for backward compatibility)
  | 'commercial_dollar_quote' // Get commercial dollar quote (legacy, kept for backward compatibility)
  | 'ai_prompt'               // Trigger AI with custom prompt
  | 'custom'                  // Reserved for future extensions

/**
 * Parameters for each action type
 */
export interface ActionParams {
  text_response: {
    template: string
  }
  price_quote: {
    prefix?: string
  }
  volume_quote: {
    prefix?: string
  }
  usdt_quote: {
    include_volume?: boolean
    custom_message_prefix?: string
  }
  commercial_dollar_quote: {
    spread_mode?: 'normal' | 'tight'
    custom_message_prefix?: string
  }
  ai_prompt: {
    prompt: string
    context?: string
    temperature?: number
  }
  custom: {
    [key: string]: any
  }
}

/**
 * Action configuration metadata
 */
export interface ActionConfig {
  type: ActionType
  label: string
  description: string
  icon: string
  color: string
  requiresParams: boolean
  category: 'response' | 'data' | 'ai' | 'custom'
}

/**
 * Available action configurations
 */
export const ACTION_CONFIGS: Record<ActionType, ActionConfig> = {
  text_response: {
    type: 'text_response',
    label: 'Text Response',
    description: 'Send a pre-written text message',
    icon: '💬',
    color: 'purple',
    requiresParams: true,
    category: 'response',
  },
  price_quote: {
    type: 'price_quote',
    label: 'Price Quote',
    description: 'Rule-aware price: uses active rule\'s source + spread',
    icon: '📊',
    color: 'green',
    requiresParams: false,
    category: 'data',
  },
  volume_quote: {
    type: 'volume_quote',
    label: 'Volume Quote',
    description: 'Rule-aware calculation: extracts amount and applies rule pricing',
    icon: '🧮',
    color: 'blue',
    requiresParams: false,
    category: 'data',
  },
  usdt_quote: {
    type: 'usdt_quote',
    label: 'USDT/BRL Quote',
    description: 'Fetch live USDT/BRL price (legacy - use Price Quote for rule-aware)',
    icon: '💵',
    color: 'green',
    requiresParams: false,
    category: 'data',
  },
  commercial_dollar_quote: {
    type: 'commercial_dollar_quote',
    label: 'Commercial Dollar',
    description: 'Fetch commercial dollar rate (legacy - use Price Quote for rule-aware)',
    icon: '💲',
    color: 'blue',
    requiresParams: false,
    category: 'data',
  },
  ai_prompt: {
    type: 'ai_prompt',
    label: 'AI Answer',
    description: 'Trigger AI classification with custom prompt',
    icon: '🤖',
    color: 'cyan',
    requiresParams: true,
    category: 'ai',
  },
  custom: {
    type: 'custom',
    label: 'Custom Action',
    description: 'Advanced: Define custom action logic',
    icon: '⚙️',
    color: 'amber',
    requiresParams: true,
    category: 'custom',
  },
}

/**
 * Get action config by type
 */
export function getActionConfig(type: ActionType): ActionConfig {
  return ACTION_CONFIGS[type]
}

/**
 * Get all action configs for a category
 */
export function getActionsByCategory(category: ActionConfig['category']): ActionConfig[] {
  return Object.values(ACTION_CONFIGS).filter(config => config.category === category)
}

/**
 * Validate action parameters
 */
export function validateActionParams(type: ActionType, params: any): { valid: boolean; error?: string } {
  switch (type) {
    case 'text_response':
      if (!params.template || typeof params.template !== 'string' || params.template.trim() === '') {
        return { valid: false, error: 'Template text is required' }
      }
      return { valid: true }

    case 'price_quote':
    case 'volume_quote':
    case 'usdt_quote':
    case 'commercial_dollar_quote':
      // Optional params, always valid
      return { valid: true }

    case 'ai_prompt':
      if (!params.prompt || typeof params.prompt !== 'string' || params.prompt.trim() === '') {
        return { valid: false, error: 'AI prompt is required' }
      }
      return { valid: true }

    case 'custom':
      // Custom actions require at least one parameter
      if (!params || Object.keys(params).length === 0) {
        return { valid: false, error: 'Custom actions require parameters' }
      }
      return { valid: true }

    default:
      return { valid: false, error: 'Unknown action type' }
  }
}

/**
 * Get display text for action (used in view mode)
 */
export function getActionDisplayText(type: ActionType, params: any): string {
  const config = getActionConfig(type)

  switch (type) {
    case 'text_response':
      return params.template || '(No template set)'

    case 'price_quote':
      return `Rule-aware price quote${params?.prefix ? ` (prefix: "${params.prefix}")` : ''}`

    case 'volume_quote':
      return `Rule-aware volume calculation${params?.prefix ? ` (prefix: "${params.prefix}")` : ''}`

    case 'usdt_quote':
      return `Fetches live USDT/BRL price from Binance${params.include_volume ? ' with volume info' : ''}`

    case 'commercial_dollar_quote':
      return `Fetches commercial dollar rate${params.spread_mode === 'tight' ? ' with tight spread' : ''}`

    case 'ai_prompt':
      return `AI Prompt: "${params.prompt}"${params.context ? `\nContext: ${params.context}` : ''}`

    case 'custom':
      return `Custom action with parameters: ${JSON.stringify(params, null, 2)}`

    default:
      return config.description
  }
}
