# Story 6.2: PDF Text Extraction Service

Status: review

## Story

As a **developer**,
I want **a service that extracts text from PDF files using unpdf**,
so that **receipt data can be parsed from PDF documents**.

## Acceptance Criteria

1. Given a PDF buffer is provided to the service, when `extractPdfText()` is called, then it returns `{ok: true, data: string}` with the extracted text

2. Given the PDF extraction completes within 5 seconds (NFR18), when the extraction succeeds, then the text is returned immediately

3. Given the PDF extraction exceeds 5 seconds, when the timeout triggers, then it returns `{ok: false, error: "PDF extraction timeout"}`

4. Given the PDF is malformed or unreadable, when extraction fails, then it returns `{ok: false, error: "..."}` with the error message and the error is logged via structured logger

## Tasks / Subtasks

- [x] Task 1: Install unpdf dependency (AC: 1)
  - [x] 1.1 Run `npm install unpdf`
  - [x] 1.2 Verify unpdf works with existing ESM/TypeScript setup
  - [x] 1.3 Add to package.json dependencies

- [x] Task 2: Create PDF extraction service (AC: 1, 4)
  - [x] 2.1 Create `src/services/pdf.ts`
  - [x] 2.2 Implement `extractPdfText(buffer: Buffer): Promise<Result<string>>`
  - [x] 2.3 Use unpdf's `extractText()` or equivalent API
  - [x] 2.4 Wrap in try-catch, return Result type on errors
  - [x] 2.5 Log extraction errors via structured logger

- [x] Task 3: Add timeout handling (AC: 2, 3)
  - [x] 3.1 Implement 5-second timeout wrapper using Promise.race
  - [x] 3.2 Return timeout error when exceeded
  - [x] 3.3 Log timeout events for debugging
  - [x] 3.4 Write unit test for successful extraction within timeout
  - [x] 3.5 Write unit test for timeout scenario

- [x] Task 4: Add error handling for malformed PDFs (AC: 4)
  - [x] 4.1 Test with various malformed PDF inputs
  - [x] 4.2 Ensure graceful error handling (no crashes)
  - [x] 4.3 Write unit test for malformed PDF handling
  - [x] 4.4 Write unit test for empty PDF handling

- [x] Task 5: Add logging for extraction metrics
  - [x] 5.1 Log extraction duration for monitoring
  - [x] 5.2 Log text length extracted for debugging

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Services never throw - always return Result type
- Structured logging via `src/utils/logger.ts`

### Source Files to Create/Modify
- `src/services/pdf.ts` - New file
- `src/services/pdf.test.ts` - New file
- `package.json` - Add unpdf dependency

### unpdf Library Usage
```typescript
import { extractText } from 'unpdf';

// Basic usage
const { text } = await extractText(pdfBuffer);
```

### Timeout Pattern (from existing code)
```typescript
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), ms)
  );
  return Promise.race([promise, timeout]);
};
```

### Testing Standards
- Co-located tests in `src/services/pdf.test.ts`
- Use sample PDF buffers for testing (can create minimal PDFs programmatically)
- Test timeout with mock delays

### NFR Reference
- NFR18: PDF text extraction completes within 5 seconds or times out

### Project Structure Notes
- Follows existing service pattern (binance.ts, excel.ts, supabase.ts)
- Snake_case for any future Supabase columns, camelCase in TypeScript

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Error-Handling]
- [Source: src/utils/result.ts - Result type pattern]
- [Source: src/services/binance.ts - service pattern example]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References
- All 20 PDF service tests pass
- Tests cover: successful extraction, timeout handling, malformed PDF handling, logging verification

### Completion Notes List
- Installed unpdf ^1.4.0 dependency
- Created extractPdfText() function with Promise.race timeout (5s NFR18)
- Returns Result<string> type - never throws
- Logs extraction metrics (duration, text length)
- Logs timeout events with duration and timeout config
- Logs extraction errors with details
- Handles undefined/null text in unpdf response
- 20 comprehensive tests cover all ACs

### File List
- src/services/pdf.ts (created)
- src/services/pdf.test.ts (created)
- package.json (modified - unpdf dependency)

## Change Log
- 2026-01-19: Story 6.2 implemented - PDF text extraction service with full test coverage
