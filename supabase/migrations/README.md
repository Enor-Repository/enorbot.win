# Supabase Migrations

This folder contains SQL migrations for eNorBOT. Apply these in order in the Supabase SQL Editor.

## Migration Order

1. `20260115_001_create_sessions_table.sql` - Session persistence (Story 1.2)
2. `20260116_001_create_log_queue_table.sql` - Excel offline queue (Story 5.3)
3. `20260119_001_create_receipts_table.sql` - Receipt storage (Story 6.5)

## How to Apply

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy-paste each migration file content in order
5. Run each migration

## Additional Setup Required

### Supabase Storage Bucket (Story 6.6)

Create a storage bucket for raw receipt files:

1. Go to **Storage** in Supabase dashboard
2. Click **New bucket**
3. Name: `receipts`
4. Public bucket: **Yes** (for URL access)
5. File size limit: 10MB (recommended)

## Verification

After applying migrations, verify tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('sessions', 'log_queue', 'receipts');
```

Expected output: 3 rows
