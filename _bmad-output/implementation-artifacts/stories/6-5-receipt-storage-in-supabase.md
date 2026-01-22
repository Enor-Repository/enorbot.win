# Story 6.5: Receipt Storage in Supabase

Status: review

## Story

As a **CIO**,
I want **validated receipts stored in Supabase**,
so that **I have a permanent record of all payment confirmations**.

## Acceptance Criteria

1. Given a validated ReceiptData object, when `storeReceipt()` is called, then a new row is inserted into the `receipts` table

2. Given the receipts table schema, when a receipt is stored, then it contains: id (uuid), end_to_end_id (unique), valor, data_hora, tipo, recebedor (jsonb), pagador (jsonb), raw_file_url, source_type, group_jid, created_at

3. Given a receipt with the same EndToEnd ID already exists, when `storeReceipt()` is called (FR34 deduplication), then it returns `{ok: false, error: "Duplicate receipt"}` and the duplicate is NOT inserted

4. Given storage succeeds, when the insert completes, then it returns `{ok: true, data: {id, end_to_end_id}}`

## Tasks / Subtasks

- [x] Task 1: Create Supabase receipts table (AC: 2)
  - [x] 1.1 Write SQL migration for `receipts` table (documented in Dev Notes, manual apply required)
  - [x] 1.2 Add `id` UUID primary key with default gen_random_uuid()
  - [x] 1.3 Add `end_to_end_id` VARCHAR with UNIQUE constraint
  - [x] 1.4 Add `valor` BIGINT (centavos)
  - [x] 1.5 Add `data_hora` TIMESTAMPTZ
  - [x] 1.6 Add `tipo` VARCHAR nullable
  - [x] 1.7 Add `recebedor` JSONB
  - [x] 1.8 Add `pagador` JSONB
  - [x] 1.9 Add `raw_file_url` VARCHAR nullable
  - [x] 1.10 Add `source_type` VARCHAR ('pdf' or 'image')
  - [x] 1.11 Add `group_jid` VARCHAR
  - [x] 1.12 Add `created_at` TIMESTAMPTZ with default now()
  - [ ] 1.13 Apply migration to Supabase (manual step required before production)

- [x] Task 2: Create receipt storage service (AC: 1, 4)
  - [x] 2.1 Create `src/services/receiptStorage.ts`
  - [x] 2.2 Implement `storeReceipt(data: ReceiptData, meta: ReceiptMeta): Promise<Result<{id, end_to_end_id}>>`
  - [x] 2.3 Transform ReceiptData to snake_case for Supabase
  - [x] 2.4 Use Supabase client (lazy init with existing config)
  - [x] 2.5 Return Result type with inserted record info

- [x] Task 3: Implement deduplication (AC: 3)
  - [x] 3.1 Handle unique constraint violation on end_to_end_id
  - [x] 3.2 Detect Postgres error code for unique violation (23505)
  - [x] 3.3 Return `{ok: false, error: "Duplicate receipt"}` on duplicate
  - [x] 3.4 Write unit test for duplicate detection

- [x] Task 4: Add comprehensive tests
  - [x] 4.1 Write unit test for successful storage
  - [x] 4.2 Write unit test for duplicate handling
  - [x] 4.3 Write unit test for Supabase error handling
  - [x] 4.4 Write integration test with real Supabase (optional - skipped, unit tests sufficient)

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Use existing Supabase client pattern from `src/services/supabase.ts`
- snake_case for database columns, camelCase in TypeScript

### Source Files to Create/Modify
- `src/services/receiptStorage.ts` - New file
- `src/services/receiptStorage.test.ts` - New file
- `supabase/migrations/xxx_create_receipts_table.sql` - Migration

### SQL Migration
```sql
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  end_to_end_id VARCHAR(100) UNIQUE NOT NULL,
  valor BIGINT NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  tipo VARCHAR(100),
  recebedor JSONB NOT NULL,
  pagador JSONB NOT NULL,
  raw_file_url VARCHAR(500),
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('pdf', 'image')),
  group_jid VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_receipts_end_to_end_id ON receipts(end_to_end_id);
CREATE INDEX idx_receipts_group_jid ON receipts(group_jid);
CREATE INDEX idx_receipts_created_at ON receipts(created_at);
```

### Data Transformation
```typescript
// TypeScript (camelCase) → Supabase (snake_case)
const row = {
  end_to_end_id: data.identificador,
  valor: data.valor,
  data_hora: data.dataHora,
  tipo: data.tipo,
  recebedor: data.recebedor,
  pagador: data.pagador,
  raw_file_url: meta.rawFileUrl,
  source_type: meta.sourceType,
  group_jid: meta.groupJid,
};
```

### Duplicate Detection
```typescript
try {
  const { data, error } = await supabase.from('receipts').insert(row).select().single();
  if (error?.code === '23505') {
    return { ok: false, error: 'Duplicate receipt' };
  }
  // ...
} catch (e) {
  // ...
}
```

### Testing Standards
- Co-located tests in `src/services/receiptStorage.test.ts`
- Mock Supabase client for unit tests
- Use actual Supabase for integration tests (optional)

### NFR Reference
- NFR19: Receipt data stored in Supabase follows existing snake_case conventions

### Project Structure Notes
- Follows existing Supabase service pattern
- Migration goes in `supabase/migrations/` if exists, otherwise document SQL

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.5]
- [Source: _bmad-output/planning-artifacts/architecture.md#Supabase-Integration]
- [Source: src/services/supabase.ts - existing Supabase client]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
- Fixed 2 failing tests for `receiptExists` - mock was returning function instead of promise

### Completion Notes List
- Created `src/services/receiptStorage.ts` with `storeReceipt()` and `receiptExists()` functions
- Both functions follow Result<T> pattern and never throw
- Handles Postgres error code 23505 for unique constraint violation (deduplication)
- 17 unit tests passing covering all ACs
- SQL migration documented in Dev Notes (no supabase/migrations folder exists)
- Migration needs to be manually applied to Supabase before production use

### File List
- src/services/receiptStorage.ts (created)
- src/services/receiptStorage.test.ts (created)
- SQL migration documented in story Dev Notes section (manual apply required)
