# Credentials Documentation

This document tracks all credentials used by eNorBOT. All credentials are stored in `.env` (gitignored) and documented in `.env.example`.

## Supabase

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `SUPABASE_URL` | Database and REST API endpoint | Supabase Dashboard > Project Settings > API |
| `SUPABASE_KEY` | Service role key for full table access | Supabase Dashboard > Project Settings > API (use "service_role" key) |
| `SUPABASE_ACCESS_TOKEN` | Management API for CLI migrations | https://supabase.com/dashboard/account/tokens |

**Project:** `jhkpgltugjurvzqpaunw`

### SUPABASE_ACCESS_TOKEN

- **Added:** 2026-01-27
- **Purpose:** Used by Supabase CLI for running migrations (`supabase db push`)
- **Regenerate:** https://supabase.com/dashboard/account/tokens
- **Note:** This is a personal access token, not project-specific

## Microsoft Graph (Excel Logging)

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `MS_GRAPH_CLIENT_ID` | Azure AD App ID | Azure Portal > App Registrations |
| `MS_GRAPH_CLIENT_SECRET` | App secret for auth | Azure Portal > App Registrations > Certificates & secrets |
| `MS_GRAPH_TENANT_ID` | Azure AD Tenant | Azure Portal > Azure Active Directory > Overview |
| `EXCEL_SITE_ID` | SharePoint site ID | MS Graph API call |
| `EXCEL_DRIVE_ID` | OneDrive drive ID | MS Graph API call |
| `EXCEL_FILE_ID` | Excel workbook ID | MS Graph API call |
| `EXCEL_WORKSHEET_NAME` | Worksheet name | Your Excel file |
| `EXCEL_TABLE_NAME` | Table name in worksheet | Your Excel file |

**Admin Approval:** Sites.ReadWrite.All and Files.ReadWrite.All granted 2026-01-23

## OpenRouter (AI/LLM)

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `OPENROUTER_API_KEY` | API key for Claude Haiku Vision (receipt OCR) | https://openrouter.ai/keys |

## WhatsApp Bot

| Variable | Purpose |
|----------|---------|
| `PHONE_NUMBER` | Phone number linked to WhatsApp session |
| `CONTROL_GROUP_PATTERN` | Pattern to identify control group (e.g., "CONTROLE_eNorBOT") |

---

## Security Notes

1. **Never commit `.env` to git** - It's gitignored for a reason
2. **Rotate secrets if exposed** - Especially OpenRouter and MS Graph secrets
3. **Use environment-specific credentials** - Different keys for dev/prod
4. **Service role key has full access** - Treat SUPABASE_KEY with care

---

*Last Updated: 2026-01-27*
