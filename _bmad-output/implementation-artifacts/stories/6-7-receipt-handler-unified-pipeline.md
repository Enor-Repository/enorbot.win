# Story 6.7: Receipt Handler (Unified Pipeline)

Status: review

## Story

As a **developer**,
I want **a unified receipt handler that processes both PDFs and images**,
so that **the router has a single entry point for receipt processing**.

## Acceptance Criteria

1. Given a receipt message with type 'pdf', when the receipt handler processes it, then it: downloads the document → extracts text via unpdf → parses receipt data → validates → stores

2. Given a receipt message with type 'image', when the receipt handler processes it, then it: downloads the image → sends to OpenRouter OCR → validates response → stores

3. Given PDF text extraction succeeds but parsing fails, when the handler detects parsing failure, then it falls back to OpenRouter OCR for the PDF (treating it as an image)

4. Given receipt processing succeeds, when all steps complete, then the handler returns `{ok: true, data: {receiptId, endToEndId}}` and NO notification is sent to control group (silent success)

5. Given receipt processing fails at any step, when the error is unrecoverable, then the handler returns `{ok: false, error: "..."}` and a notification IS sent to control group: "⚠️ Receipt processing failed: [reason]" (FR35)

## Tasks / Subtasks

- [x] Task 1: Create receipt handler structure (AC: 1, 2)
  - [x] 1.1 Replaced stub in `src/handlers/receipt.ts`
  - [x] 1.2 Implemented `handleReceipt(context: RouterContext): Promise<Result<ReceiptHandlerResult>>`
  - [x] 1.3 Routes to PDF or image processing based on receiptType
  - [x] 1.4 Wired up all service dependencies

- [x] Task 2: Implement PDF processing pipeline (AC: 1)
  - [x] 2.1 Download document via Baileys `downloadMediaMessage`
  - [x] 2.2 Call PDF extraction service (Story 6.2)
  - [x] 2.3 Parse extracted text (Story 6.4)
  - [x] 2.4 Validate parsed data
  - [x] 2.5 Store raw file (Story 6.6) with graceful degradation
  - [x] 2.6 Store receipt data (Story 6.5)
  - [x] 2.7 Write unit tests for PDF flow

- [x] Task 3: Implement image processing pipeline (AC: 2)
  - [x] 3.1 Download image via Baileys `downloadMediaMessage`
  - [x] 3.2 Call OpenRouter OCR service (Story 6.3)
  - [x] 3.3 Validate OCR response
  - [x] 3.4 Store raw file (Story 6.6) with graceful degradation
  - [x] 3.5 Store receipt data (Story 6.5)
  - [x] 3.6 Write unit tests for image flow

- [x] Task 4: Implement PDF-to-OCR fallback (AC: 3)
  - [x] 4.1 Detect parsing failure from PDF text
  - [x] 4.2 Send PDF buffer directly to Claude Haiku Vision
  - [x] 4.3 Retry with OpenRouter OCR
  - [x] 4.4 Log fallback occurrence
  - [x] 4.5 Write unit test for fallback scenario

- [x] Task 5: Implement success handling (AC: 4)
  - [x] 5.1 Return success Result with receiptId and endToEndId
  - [x] 5.2 NO control group notification on success (silent)
  - [x] 5.3 Log successful processing
  - [x] 5.4 Write unit test verifying silent success

- [x] Task 6: Implement failure handling (AC: 5 partial)
  - [x] 6.1 Detect unrecoverable errors at any pipeline step
  - [ ] 6.2 Call notification service for control group (moved to Story 6.8)
  - [ ] 6.3 Include failure reason in notification (moved to Story 6.8)
  - [x] 6.4 Return error Result
  - [x] 6.5 Write unit test for failure handling

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Use sendWithAntiDetection for control group notifications
- Handler pattern established in `src/handlers/price.ts` and `src/handlers/control.ts`

### Source Files to Create/Modify
- `src/handlers/receipt.ts` - Main handler file
- `src/handlers/receipt.test.ts` - Unit tests
- `src/bot/router.ts` - Wire up handler (if not done in 6.1)

### Dependencies (from previous stories)
- `src/services/pdf.ts` (Story 6.2)
- `src/services/openrouter.ts` (Story 6.3)
- `src/services/receiptParser.ts` (Story 6.4)
- `src/services/receiptStorage.ts` (Story 6.5)
- `src/services/fileStorage.ts` (Story 6.6)

### Pipeline Flow Diagram
```
[Router] → [Receipt Handler]
                ↓
         ┌──────┴──────┐
         │             │
      [PDF]        [Image]
         ↓             ↓
    [unpdf]      [OpenRouter]
         ↓             ↓
    [Parser]      [Validate]
         ↓             ↓
    ┌────┴────┐        │
    │         │        │
 [Success] [Fail]      │
    │         ↓        │
    │   [Fallback]─────┤
    │         ↓        │
    └─────────┴────────┘
              ↓
       [Store File]
              ↓
       [Store Data]
              ↓
    ┌─────────┴─────────┐
    │                   │
 [Success]          [Failure]
    │                   │
 [Silent]        [Notify CIO]
```

### Baileys Document Download
```typescript
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const buffer = await downloadMediaMessage(
  message,
  'buffer',
  {},
  { logger: undefined, reuploadRequest: sock.updateMediaMessage }
);
```

### Notification Format
```typescript
const notifyFailure = async (groupName: string, sender: string, reason: string) => {
  const message = `⚠️ Receipt failed | ${groupName} | ${sender} | ${reason}`;
  await sendToControlGroup(message);
};
```

### Testing Standards
- Co-located tests in `src/handlers/receipt.test.ts`
- Mock all service dependencies
- Test each pipeline path independently
- Test fallback scenario

### Project Structure Notes
- Handler follows existing pattern (price.ts, control.ts)
- Orchestrates all services from previous stories
- Entry point for receipt processing

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.7]
- [Source: src/handlers/price.ts - handler pattern]
- [Source: src/handlers/control.ts - notification pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
- All 27 tests passed on first run

### Completion Notes List
- Replaced stub implementation in `src/handlers/receipt.ts`
- Full pipeline: download → extract → parse → validate → store file → store data
- PDF processing with fallback to OCR when extraction/parsing/validation fails
- Image processing via OpenRouter Claude Haiku Vision
- Graceful degradation for file storage (continues without file if storage fails)
- Silent success (no control group notification)
- Failure notifications moved to Story 6.8
- 27 unit tests covering all ACs except notification (6.8)

### File List
- src/handlers/receipt.ts (updated from stub)
- src/handlers/receipt.test.ts (created)
