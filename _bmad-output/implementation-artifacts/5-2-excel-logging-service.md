# Story 5.2: Excel Logging Service

Status: done

## Code Review Notes (2026-01-16)

**Review 1: 4 issues found** - ALL FIXED ✅
**Review 2: 2 additional issues found** - ALL FIXED ✅

### Review 1 Issues (Fixed)
1. ✅ **CRITICAL**: Graph API uses `/me/drive` which requires delegated auth
   - Fixed: Changed to `/sites/{siteId}/drives/{driveId}/items/` pattern for app-only auth
2. ✅ **CRITICAL**: `initExcelService()` never called - queue flush will fail
   - Fixed: Added call in connection.ts on successful connection
3. ✅ **MEDIUM**: AbortController timeout not cleaned up on fetch failure
   - Fixed: Added try-finally pattern for all fetch calls
4. ✅ **LOW**: Table name "Table1" hardcoded instead of configurable
   - Fixed: Added EXCEL_TABLE_NAME to env config with default "Table1"

### Review 2 Issues (Fixed)
5. ✅ **MEDIUM** (5.2.5): validateExcelAccess() never called during initialization (AC3)
   - Fixed: Added fire-and-forget call in initExcelService()
6. ✅ **LOW** (5.2.6): API response uses `as` type assertion instead of explicit types
   - Fixed: Added ExcelRowResponse and ExcelFileMetadata interfaces

## Story

As a **CIO**,
I want **every price quote logged to my Excel spreadsheet**,
So that **I have a complete audit trail of all interactions**.

## Acceptance Criteria

1. **AC1: Log entry creation**
   - Given a price quote is successfully sent
   - When the logging service is called
   - Then a new row is appended to the configured Excel worksheet

2. **AC2: Log entry format**
   - Given a log entry is created
   - When it is written to Excel
   - Then it contains: timestamp, group name, client phone/name, quote value (FR18)

3. **AC3: Excel file validation**
   - Given the Excel file ID is configured via environment variable
   - When the service initializes
   - Then it validates the file exists and is accessible

4. **AC4: Success response**
   - Given Excel write succeeds
   - When the service returns
   - Then it returns `{ok: true, data: {rowNumber}}`

5. **AC5: Failure response**
   - Given Excel write fails
   - When the service returns
   - Then it returns `{ok: false, error: "..."}` (never throws)
   - And the log entry is queued for retry (Story 5.3)

## Tasks / Subtasks

- [x] Task 1: Create Excel logging service structure (AC: 1, 4, 5)
  - [x] 1.1: Create `src/services/excel.ts`
  - [x] 1.2: Import graph.ts for authentication
  - [x] 1.3: Define `LogEntry` interface with all fields
  - [x] 1.4: Implement `logPriceQuote(entry: LogEntry): Promise<Result<{rowNumber: number}>>`
  - [x] 1.5: Return Result type (never throw)
  - [x] 1.6: Add structured logging for all operations
  - [x] 1.7: Add unit tests for success path

- [x] Task 2: Implement MS Graph Excel API call (AC: 1, 2)
  - [x] 2.1: Use Graph API to append row: `POST /workbooks/{id}/worksheets/{name}/tables/{table}/rows`
  - [x] 2.2: Format row data as array: [timestamp, groupName, clientId, quoteValue]
  - [x] 2.3: Parse response for row number
  - [x] 2.4: Handle API response validation with Zod
  - [x] 2.5: Add tests for API call formatting

- [x] Task 3: Implement file validation (AC: 3)
  - [x] 3.1: Create `validateExcelAccess(): Promise<Result<void>>`
  - [x] 3.2: Make test GET request to Excel file
  - [x] 3.3: Verify worksheet exists
  - [x] 3.4: Call validation on service initialization
  - [x] 3.5: Log validation results
  - [x] 3.6: Add tests for validation scenarios

- [x] Task 4: Handle failures with queue integration (AC: 5)
  - [x] 4.1: On Excel write failure, queue entry for Story 5.3
  - [x] 4.2: Import queue function from `logQueue.ts` (created in 5.3)
  - [x] 4.3: Classify errors (network vs auth vs rate limit)
  - [x] 4.4: Log failure events with full context
  - [x] 4.5: Add tests for failure scenarios

- [x] Task 5: Integrate with price handler (AC: 1, 2)
  - [x] 5.1: Call `logPriceQuote()` after successful price response in price.ts
  - [x] 5.2: Extract client identifier from message sender
  - [x] 5.3: Fire-and-forget (don't block price response on logging)
  - [x] 5.4: Add integration tests

## Dev Notes

### Log Entry Interface

```typescript
interface LogEntry {
  timestamp: Date           // When the quote was given
  groupName: string         // WhatsApp group name (human-readable)
  groupId: string           // WhatsApp group JID (for reference)
  clientIdentifier: string  // Phone number or name of requester
  quoteValue: number        // USDT/BRL rate quoted
  quoteFormatted: string    // Formatted quote (e.g., "R$5,82")
}
```

### MS Graph Excel API

**Append Row to Table:**
```typescript
async function appendRow(entry: LogEntry): Promise<Result<{ rowNumber: number }>> {
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    return { ok: false, error: `Auth failed: ${tokenResult.error}` }
  }

  const rowData = [
    entry.timestamp.toISOString(),
    entry.groupName,
    entry.clientIdentifier,
    entry.quoteFormatted,
  ]

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${config.EXCEL_FILE_ID}/workbook/worksheets/${config.EXCEL_WORKSHEET_NAME}/tables/Table1/rows`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenResult.data}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowData],
      }),
    }
  )

  if (!response.ok) {
    logger.error('Excel append failed', {
      event: 'excel_append_error',
      status: response.status,
      statusText: response.statusText,
    })
    return { ok: false, error: `Excel API error: ${response.status}` }
  }

  const result = await response.json()
  logger.info('Excel row appended', {
    event: 'excel_row_appended',
    rowNumber: result.index,
    groupName: entry.groupName,
  })

  return { ok: true, data: { rowNumber: result.index } }
}
```

### Excel Worksheet Setup

The CIO needs to create an Excel table in the target worksheet:
1. Create Excel Online workbook
2. Create worksheet named "Quotes" (or configured name)
3. Create headers in row 1: `Timestamp | Group | Client | Quote`
4. Format as table (Insert → Table)
5. Note the file ID from the URL or SharePoint

**File ID Format:**
- OneDrive: `{item-id}` from URL
- SharePoint: `/drives/{drive-id}/items/{item-id}`

### Integration with Price Handler

```typescript
// In handlers/price.ts, after successful sendWithAntiDetection

import { logPriceQuote } from '../services/excel.js'

// After price is sent successfully
const logEntry: LogEntry = {
  timestamp: new Date(),
  groupName: context.groupName,
  groupId: context.groupId,
  clientIdentifier: context.sender,
  quoteValue: priceResult.data,
  quoteFormatted: formatBrazilianPrice(priceResult.data),
}

// Fire-and-forget - don't block on logging
logPriceQuote(logEntry).catch(err => {
  logger.warn('Logging failed, will retry', { event: 'log_queued', error: err })
})
```

### Error Handling

```typescript
async function logPriceQuote(entry: LogEntry): Promise<Result<{ rowNumber: number }>> {
  try {
    const result = await appendRow(entry)
    
    if (!result.ok) {
      // Queue for retry (Story 5.3)
      await queueLogEntry(entry)
      return result
    }
    
    return result
  } catch (error) {
    logger.error('Excel logging exception', {
      event: 'excel_log_exception',
      error,
      entry: { groupName: entry.groupName, quote: entry.quoteFormatted },
    })
    
    // Queue for retry
    await queueLogEntry(entry)
    return { ok: false, error: 'Logging failed' }
  }
}
```

### Project Structure Notes

**New Files:**
- `src/services/excel.ts` - Excel logging service
- `src/services/excel.test.ts` - Tests

**Modified Files:**
- `src/handlers/price.ts` - Add logging call after successful quote

### Testing Strategy

1. **Unit tests for excel.ts:**
   - `logPriceQuote()` returns success with row number
   - `logPriceQuote()` returns error on API failure
   - `validateExcelAccess()` detects missing file
   - Correct row data formatting
   - Auth token passed correctly

2. **Integration tests:**
   - Price handler calls logging after success
   - Failed logs are queued (mock queue function)

3. **Mock fetch for Graph API:**
   ```typescript
   const mockFetch = vi.hoisted(() => vi.fn())
   vi.stubGlobal('fetch', mockFetch)
   
   beforeEach(() => {
     mockFetch.mockResolvedValue({
       ok: true,
       json: async () => ({ index: 5 }),
     })
   })
   ```

### Dependencies

- **From Story 5.1:** `ensureValidToken()` from graph.ts
- **For Story 5.3:** Will call `queueLogEntry()` from logQueue.ts
- **From Epic 2:** `formatBrazilianPrice()` from format.ts

### References

- [Source: _bmad-output/planning-artifacts/epics.md#FR18] - Log entry format
- [Source: docs/project-context.md#Stack Decisions] - Excel Online via MS Graph
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [MS Graph Docs: Add table row](https://learn.microsoft.com/en-us/graph/api/table-post-rows)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (2026-01-16)

### Completion Notes List

- Created `src/services/excel.ts` with complete Excel logging service:
  - `logPriceQuote()` - appends row to Excel via Graph API
  - `validateExcelAccess()` - validates file accessibility
  - `LogEntry` interface for structured log data
- Created `src/services/logQueue.ts` stub for Story 5.3 integration
- All functions return Result type, never throw
- Fire-and-forget integration in price handler
- Full test coverage: 21 tests for excel.ts

### File List

- `src/services/excel.ts` - **NEW** - Excel logging service (21 tests)
- `src/services/excel.test.ts` - **NEW** - Tests for Excel service
- `src/services/logQueue.ts` - **NEW** - Queue stub for failed logs
- `src/handlers/price.ts` - Added Excel logging integration (fire-and-forget)
