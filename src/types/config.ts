import { z } from 'zod'

/**
 * Zod schema for environment validation.
 * All environment variables are validated at startup.
 */
export const envSchema = z.object({
  // Supabase - REQUIRED for session persistence
  SUPABASE_URL: z
    .string()
    .url('SUPABASE_URL must be a valid URL (e.g., https://your-project.supabase.co)'),
  SUPABASE_KEY: z
    .string()
    .min(20, 'SUPABASE_KEY must be a valid service role key (use the service_role key, not anon)'),

  // MS Graph - REQUIRED for Excel logging (Story 5.1)
  // Azure AD App Registration credentials for client credentials OAuth2 flow
  MS_GRAPH_CLIENT_ID: z
    .string()
    .uuid('MS_GRAPH_CLIENT_ID must be a valid Azure AD Application (client) ID')
    .optional(),
  MS_GRAPH_CLIENT_SECRET: z
    .string()
    .min(10, 'MS_GRAPH_CLIENT_SECRET must be a valid Azure AD client secret')
    .optional(),
  MS_GRAPH_TENANT_ID: z
    .string()
    .uuid('MS_GRAPH_TENANT_ID must be a valid Azure AD Directory (tenant) ID')
    .optional(),

  // OpenRouter - REQUIRED for image OCR (Story 6.3)
  // API key from https://openrouter.ai/keys
  OPENROUTER_API_KEY: z
    .string()
    .min(10, 'OPENROUTER_API_KEY must be a valid OpenRouter API key')
    .optional(),

  // Excel configuration - REQUIRED for Excel logging (Story 5.2)
  // For app-only permissions, use SharePoint site ID and drive ID
  EXCEL_SITE_ID: z
    .string()
    .min(1, 'EXCEL_SITE_ID must be a SharePoint site ID (e.g., contoso.sharepoint.com,guid,guid)')
    .optional(),
  EXCEL_DRIVE_ID: z
    .string()
    .min(1, 'EXCEL_DRIVE_ID must be a OneDrive/SharePoint drive ID')
    .optional(),
  EXCEL_FILE_ID: z
    .string()
    .min(1, 'EXCEL_FILE_ID must be a valid OneDrive file ID or path')
    .optional(),
  EXCEL_WORKSHEET_NAME: z
    .string()
    .min(1, 'EXCEL_WORKSHEET_NAME must be a valid worksheet name')
    .default('Quotes'),
  // Issue 5.2.4 fix: Make table name configurable
  EXCEL_TABLE_NAME: z
    .string()
    .min(1, 'EXCEL_TABLE_NAME must be a valid Excel table name')
    .default('Table1'),

  // Bot configuration
  PHONE_NUMBER: z.string().regex(
    /^\d{12,15}$/,
    'PHONE_NUMBER must be 12-15 digits (e.g., 5511999999999 for Brazil +55 11 99999-9999)'
  ),
  CONTROL_GROUP_PATTERN: z.string().min(1).default('CONTROLE'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HEALTH_PORT: z.string().default('3000').transform(Number).pipe(z.number().int().min(1).max(65535)),
})

export type EnvConfig = z.infer<typeof envSchema>

/**
 * Check if MS Graph is configured.
 * All three MS Graph env vars must be set for Excel logging to work.
 */
export function isMsGraphConfigured(config: EnvConfig): boolean {
  return !!(
    config.MS_GRAPH_CLIENT_ID &&
    config.MS_GRAPH_CLIENT_SECRET &&
    config.MS_GRAPH_TENANT_ID
  )
}

/**
 * Check if Excel logging is configured.
 * Requires MS Graph AND Excel drive/file IDs to be set.
 * For app-only auth, requires EXCEL_SITE_ID, EXCEL_DRIVE_ID, and EXCEL_FILE_ID.
 */
export function isExcelLoggingConfigured(config: EnvConfig): boolean {
  return (
    isMsGraphConfigured(config) &&
    !!config.EXCEL_SITE_ID &&
    !!config.EXCEL_DRIVE_ID &&
    !!config.EXCEL_FILE_ID
  )
}

/**
 * Check if OpenRouter is configured for image OCR.
 * Story 6.3 - Required for receipt image processing.
 */
export function isOpenRouterConfigured(config: EnvConfig): boolean {
  return !!config.OPENROUTER_API_KEY
}
