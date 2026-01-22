# Story 6.1: Receipt Detection in Router

Status: review

## Story

As a **developer**,
I want **the router to detect when a PDF or image is received in a monitored group**,
so that **receipt documents are dispatched to the appropriate handler**.

## Acceptance Criteria

1. Given a message arrives in a monitored group, when the message contains a document with MIME type `application/pdf`, then the router flags it as `isReceipt: true` and `receiptType: 'pdf'`

2. Given a message arrives in a monitored group, when the message contains an image (MIME type `image/jpeg`, `image/png`, `image/webp`), then the router flags it as `isReceipt: true` and `receiptType: 'image'`

3. Given a receipt message is detected, when the router dispatches the message, then it is sent to the receipt handler (not the price handler)

4. Given a document/image arrives from the control group, when the router processes the message, then it is NOT sent to the receipt handler (control group excluded)

## Tasks / Subtasks

- [x] Task 1: Update router types for receipt detection (AC: 1, 2)
  - [x] 1.1 Add `isReceipt: boolean` and `receiptType: 'pdf' | 'image' | null` to RouterResult type
  - [x] 1.2 Add MIME type constants for PDF and supported image formats
  - [x] 1.3 Write unit tests for type definitions

- [x] Task 2: Implement document/image detection in router (AC: 1, 2)
  - [x] 2.1 Add `detectReceiptType()` function that checks message for documents
  - [x] 2.2 Extract MIME type from message.documentMessage or message.imageMessage
  - [x] 2.3 Return appropriate receiptType based on MIME type matching
  - [x] 2.4 Write unit tests for PDF detection
  - [x] 2.5 Write unit tests for image detection (jpeg, png, webp)

- [x] Task 3: Update router dispatch logic (AC: 3, 4)
  - [x] 3.1 Modify `routeMessage()` to call `detectReceiptType()` for non-control-group messages
  - [x] 3.2 Add routing path for receipt handler when isReceipt is true
  - [x] 3.3 Ensure control group messages bypass receipt detection
  - [x] 3.4 Write unit tests for receipt routing
  - [x] 3.5 Write unit tests for control group exclusion

- [x] Task 4: Create receipt handler stub (AC: 3)
  - [x] 4.1 Create `src/handlers/receipt.ts` with placeholder handler function
  - [x] 4.2 Handler should return Result type consistent with other handlers
  - [x] 4.3 Log receipt detection for debugging

## Dev Notes

### Architecture Patterns
- Follow existing Result<T> pattern from `src/utils/result.ts`
- Router pattern established in `src/bot/router.ts` - extend, don't replace
- Existing message type detection in router uses Baileys message structure

### Source Files to Modify
- `src/bot/router.ts` - Add receipt detection logic
- `src/bot/router.test.ts` - Add receipt detection tests
- `src/types/handlers.ts` - Add receipt-related types
- `src/handlers/receipt.ts` - New file (stub)

### Testing Standards
- Co-located tests (*.test.ts next to source)
- Use existing test patterns from router.test.ts
- Mock Baileys message structures for document/image messages

### Baileys Message Structure Reference
```typescript
// Document message
message.documentMessage?.mimetype // 'application/pdf'
message.documentMessage?.fileName

// Image message
message.imageMessage?.mimetype // 'image/jpeg', 'image/png', 'image/webp'
```

### Project Structure Notes
- Aligns with existing handler pattern (price.ts, control.ts)
- Receipt handler will be in `src/handlers/receipt.ts`
- Types follow existing convention in `src/types/`

### References
- [Source: _bmad-output/planning-artifacts/architecture.md#Project-Structure]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.1]
- [Source: src/bot/router.ts - existing routing logic]
- [Source: src/types/handlers.ts - existing type patterns]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References
- All 32 router tests pass including 17 new receipt detection tests
- Pre-existing failures in price.test.ts (unrelated to this story)

### Completion Notes List
- Added ReceiptType, ReceiptHandlerResult, RECEIPT_MIME_TYPES, SUPPORTED_IMAGE_MIME_TYPES to handlers.ts
- Added RECEIPT_HANDLER to RouteDestination enum
- Added BaileysMessage interface for type-safe document/image detection
- Added isReceipt, receiptType, rawMessage to RouterContext
- Implemented detectReceiptType() function with PDF and image support
- Updated routeMessage() to detect receipts and route to RECEIPT_HANDLER
- Control group messages bypass receipt detection (AC4)
- Created receipt handler stub with logging
- Added 17 comprehensive tests for receipt detection

### File List
- src/bot/router.ts (modified)
- src/bot/router.test.ts (modified)
- src/types/handlers.ts (modified)
- src/handlers/receipt.ts (created)

## Change Log
- 2026-01-19: Story 6.1 implemented - receipt detection in router with full test coverage
